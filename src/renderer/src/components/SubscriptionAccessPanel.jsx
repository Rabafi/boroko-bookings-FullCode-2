import { useEffect, useMemo, useState } from 'react'
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
  Lock
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
  getPlanUsageLimits,
  getUsageLimitStatus,
  formatPlanLimits,
  normalizeSubscriptionPlan,
  buildUpgradeRequestDescription
} from '../../../shared/subscriptionPlans'
import {
  ENTERPRISE_ADDON_STATUS,
  isEnterpriseAddonEnabled
} from '../../../shared/enterpriseAddons'
import { getCommercialPackageCatalog, getCommercialPackageDisplayName, getCommercialPackageLabel, getAdvertisedEnterpriseAddons } from '../../../shared/commercialPackages'
import { getProductDefinition, getRuntimeProductId } from '../../../shared/productIdentity'
import { isCommercialFeatureIncluded } from '../../../shared/commercialAccess.js'
import UsageLimitIndicator from './shared/UsageLimitIndicator'

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())
const IS_HOTEL_PRODUCT = BUILD_PRODUCT.id === 'hotel'
const IS_POS_PRODUCT = BUILD_PRODUCT.id === 'hospitality-pos'
const IS_LODGE_PRODUCT = BUILD_PRODUCT.id === 'lodge-camp'

function fmtDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function paymentBadge(status) {
  if (!status) return <span className="text-sm text-gray-500">—</span>
  const map = {
    active: 'bg-green-100 text-green-700',
    free: 'bg-blue-100 text-blue-700',
    trial: 'bg-blue-100 text-blue-700',
    grace_period: 'bg-amber-100 text-amber-700',
    overdue: 'bg-amber-100 text-amber-700',
    suspended: 'bg-red-100 text-red-700',
    cancelled: 'bg-red-100 text-red-700',
    expired: 'bg-red-100 text-red-700',
    offline_lease_expired: 'bg-red-100 text-red-700'
  }
  return (
    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${map[String(status).toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
      {String(status).replace(/_/g, ' ')}
    </span>
  )
}

function getRecommendedUpgradePlan(currentPlan) {
  const normalizedPlan = normalizeSubscriptionPlan(currentPlan)
  if (IS_HOTEL_PRODUCT || IS_POS_PRODUCT) return null
  if (normalizedPlan === 'Starter') return 'Standard'
  if (normalizedPlan === 'Standard') return 'Pro'
  if (normalizedPlan === 'Pro') return 'Enterprise'
  return null
}

function StatusHero({ licenseStatus }) {
  if (!licenseStatus) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <p className="text-sm text-gray-400">Checking subscription status…</p>
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
    <div className={`rounded-3xl p-6 shadow-sm bg-gradient-to-br ${toneClasses[tone]}`}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 bg-white/15 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide">
            {licensed ? <ShieldCheck size={13} /> : expired ? <AlertTriangle size={13} /> : <Clock size={13} />}
            {licensed ? 'Licensed' : expired ? 'Action required' : 'Trial mode'}
          </div>
          <h2 className="text-2xl font-bold mt-4">
            {licensed
              ? `${planLabel} plan active`
              : expired
                ? 'Access is paused until the property is activated'
                : `${licenseStatus.daysLeft || 0} day${licenseStatus.daysLeft === 1 ? '' : 's'} left in trial`}
          </h2>
          <p className="text-sm text-white/85 mt-2">
            {licensed
              ? subscriptionState === 'grace_period'
                ? 'this property is still running, but it is inside a grace period. Tsa Bonno will protect access until the grace window ends.'
                : 'this property is currently licensed and Tsa Bonno will use this entitlement as the source of truth for modules and access.'
              : expired
                ? subscriptionState === 'offline_lease_expired'
                  ? 'The device stayed offline beyond its safe entitlement window. Reconnect and refresh the subscription to restore premium access.'
                  : 'This trial has ended. Buy and activate a subscription to restore app features for this property.'
                : 'Trial mode currently unlocks the full feature set so you can test workflows before activation.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:max-w-md lg:min-w-[280px]">
          <div className="bg-white/10 rounded-2xl p-4">
            <p className="text-xs text-white/70 uppercase tracking-wide">Plan</p>
            <p className="text-lg font-bold mt-1">{planLabel}</p>
          </div>
          <div className="bg-white/10 rounded-2xl p-4">
            <p className="text-xs text-white/70 uppercase tracking-wide">Standing</p>
            <div className="mt-2">{paymentBadge(licenseStatus.payment_status || licenseStatus.status)}</div>
          </div>
          <div className="bg-white/10 rounded-2xl p-4">
            <p className="text-xs text-white/70 uppercase tracking-wide">Next due</p>
            <p className="text-sm font-semibold mt-1">{fmtDate(licenseStatus.next_due_date)}</p>
          </div>
          <div className="bg-white/10 rounded-2xl p-4">
            <p className="text-xs text-white/70 uppercase tracking-wide">Expiry</p>
            <p className="text-sm font-semibold mt-1">{fmtDate(licenseStatus.expires_at)}</p>
          </div>
          <div className="bg-white/10 rounded-2xl p-4">
            <p className="text-xs text-white/70 uppercase tracking-wide">Grace ends</p>
            <p className="text-sm font-semibold mt-1">{fmtDate(licenseStatus.grace_period_ends_at)}</p>
          </div>
          <div className="bg-white/10 rounded-2xl p-4">
            <p className="text-xs text-white/70 uppercase tracking-wide">Offline safe until</p>
            <p className="text-sm font-semibold mt-1">{fmtDate(licenseStatus.offline_valid_until)}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SubscriptionAccessPanel() {
  const { settings } = useSettings()
  const { user } = useAuth()
  const access = useAccess()
  const [licenseStatus, setLicenseStatus] = useState(null)
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [activateMsg, setActivateMsg] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')
  const [upgradeSending, setUpgradeSending] = useState(false)
  const [upgradeSent, setUpgradeSent] = useState(false)
  const [requestedPackageKey, setRequestedPackageKey] = useState(IS_HOTEL_PRODUCT ? 'hotel_core' : IS_POS_PRODUCT ? 'restaurant_growth' : 'standard')
  const [lodgeIdCopied, setLodgeIdCopied] = useState(false)
  const [usageCounts, setUsageCounts] = useState({ monthlyBookings: 0, rooms: 0, users: 0 })
  const [usageSource, setUsageSource] = useState('cache')
  const [lastUsageSyncAt, setLastUsageSyncAt] = useState(null)

  const lodgeId = settings?.lodge_id || access?.entitlement?.lodge_id
  const canManageSubscription = canAccessCapability(access, 'settings.manage_subscription')
  const entitlementExpired = licenseStatus?.expired === true
  const licensedPlan = normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter')
  const isProPlan = licensedPlan === 'Pro'
  const isEnterprisePlan = licensedPlan === 'Enterprise'
  const hasUsageLimits = !IS_POS_PRODUCT && !isProPlan && !isEnterprisePlan
  const licensedPlanIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(licensedPlan)
  const enterpriseAddons = Array.isArray(licenseStatus?.enterprise_addons)
    ? licenseStatus.enterprise_addons
    : Array.isArray(access?.entitlement?.enterprise_addons)
      ? access.entitlement.enterprise_addons
      : []
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  const commercialPackages = useMemo(
    () => getCommercialPackageCatalog(BUILD_PRODUCT.id),
    []
  )
  const currentCommercialPackageKey = licenseStatus?.commercial_package_key || access?.entitlement?.commercial_package_key || null
  const selectedCommercialPackage = commercialPackages.find((plan) => plan.commercialPackageKey === requestedPackageKey) || commercialPackages[0] || null
  const eligibleAddons = useMemo(
    () => IS_HOTEL_PRODUCT ? getAdvertisedEnterpriseAddons(propertyType, BUILD_PRODUCT.id) : [],
    [propertyType]
  )

  const isFeatureEnabled = (featureName) => {
    if (entitlementExpired) return false
    if (IS_POS_PRODUCT && currentCommercialPackageKey
      && !isCommercialFeatureIncluded(BUILD_PRODUCT.id, currentCommercialPackageKey, featureName)) return false
    const effectiveFeatures = licenseStatus?.effective_features || {}
    if (Object.prototype.hasOwnProperty.call(effectiveFeatures, featureName)) {
      return effectiveFeatures[featureName] !== false
    }
    if (licenseStatus?.status === 'trial') return true
    const requiredPlan = getFeatureRequiredPlan(featureName)
    return licensedPlanIndex >= SUBSCRIPTION_PLAN_ORDER.indexOf(requiredPlan)
  }

  const refreshStatus = async () => {
    if (!lodgeId || !window.api?.trial?.getStatus) return
    const nextStatus = await window.api.trial.getStatus(lodgeId).catch(() => null)
    setLicenseStatus(nextStatus)
  }

  useEffect(() => {
    refreshStatus().catch(() => {})
  }, [lodgeId])

  useEffect(() => {
    if (!lodgeId || !window.api?.trial?.getInvoices) return
    if (licenseStatus?.status !== 'licensed' || !canManageSubscription) {
      setInvoices([])
      return
    }

    window.api.trial.getInvoices(lodgeId).then((rows) => {
      setInvoices(Array.isArray(rows) ? rows : [])
    }).catch(() => setInvoices([]))
  }, [canManageSubscription, licenseStatus?.status, lodgeId])

  useEffect(() => {
    const currentKey = licenseStatus?.commercial_package_key || access?.entitlement?.commercial_package_key
    if (currentKey && commercialPackages.some((plan) => plan.commercialPackageKey === currentKey)) {
      setRequestedPackageKey(currentKey)
      return
    }
    const recommendedPlan = getRecommendedUpgradePlan(licenseStatus?.plan)
    const fallback = recommendedPlan || normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter')
    const fallbackPackage = commercialPackages.find((plan) => plan.internalPlan === fallback)
      || commercialPackages[commercialPackages.length - 1]
    if (fallbackPackage) setRequestedPackageKey(fallbackPackage.commercialPackageKey)
  }, [access?.entitlement?.commercial_package_key, commercialPackages, licenseStatus?.commercial_package_key, licenseStatus?.plan])

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

  const enabledFeatures = useMemo(() => (
    APP_FEATURES.filter((featureName) => isFeatureEnabled(featureName))
  ), [entitlementExpired, licenseStatus, licensedPlanIndex])
  const usageLimits = getPlanUsageLimits(licenseStatus?.plan || 'Starter')
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
        await refreshStatus()
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
      if (!selectedCommercialPackage?.commercialPackageKey) throw new Error('Select a package before requesting an upgrade.')
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
          notes: upgradeMsg
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
    })
  }

  return (
    <div className="space-y-5 pb-8">
      <StatusHero licenseStatus={licenseStatus} />

      <div className="grid gap-6 2xl:grid-cols-[1.25fr_0.95fr]">
         <div className="space-y-5">
           <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-gray-800">Feature Access</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {enabledFeatures.length} of {APP_FEATURES.length} controlled modules currently unlocked for this property.
                </p>
              </div>
              <div className="inline-flex w-fit items-center gap-2 bg-green-50 text-green-700 px-3 py-2 rounded-xl text-sm font-semibold">
                <Sparkles size={15} />
                 {licenseStatus?.status === 'licensed'
                   ? getCommercialPackageDisplayName({ productId: BUILD_PRODUCT.id, commercialPackageKey: licenseStatus?.commercial_package_key, plan: licenseStatus?.plan || 'Starter' })
                   : 'Trial'}
              </div>
            </div>

            {IS_POS_PRODUCT ? (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">POS entitlement</p>
                <p className="mt-2 text-sm font-semibold text-amber-800">Commercial POS packages do not inherit Lodge &amp; Camp usage caps.</p>
                <p className="mt-1 text-xs text-amber-700">Your selected package controls feature access: Service, Control, or Growth workflows.</p>
              </div>
            ) : isProPlan ? (
              <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Usage</p>
                <p className="mt-2 text-sm font-semibold text-emerald-800">Unlimited access</p>
                <p className="mt-1 text-xs text-emerald-700">No usage counters or warning bars are shown for Pro.</p>
              </div>
            ) : isEnterprisePlan ? (
              <div className="mb-4 rounded-2xl border border-purple-200 bg-purple-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">Usage</p>
                 <p className="mt-2 text-sm font-semibold text-purple-800">Hotel Core</p>
                 <p className="mt-1 text-xs text-purple-700">Hotel is an independently quoted product. It has no Lodge &amp; Camp tier or usage-cap ladder.</p>
              </div>
            ) : (
              <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Usage</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <UsageLimitIndicator label="Bookings this month" used={usageCounts.monthlyBookings} limit={usageLimits.monthlyBookings} grace={usageLimits.monthlyBookingsGrace} />
                  <UsageLimitIndicator label="Rooms" used={usageCounts.rooms} limit={usageLimits.rooms} />
                  <UsageLimitIndicator label="Users" used={usageCounts.users} limit={usageLimits.users} />
                </div>
                {usageSource === 'cache' && (
                  <p className="mt-2 text-xs text-amber-700">
                    Usage count may be outdated because the app is offline. New records may be rejected during sync if the subscription limit has already been reached.
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-500">{MONTHLY_USAGE_RESET_COPY}</p>
                {lastUsageSyncAt && <p className="mt-1 text-[11px] text-slate-500">Last usage refresh: {fmtDate(lastUsageSyncAt)}</p>}
                {bookingsUsageStatus.state === 'warning' && (
                  <p className="mt-2 text-xs text-amber-700">Booking usage is above 80% of the monthly limit.</p>
                )}
                {bookingsUsageStatus.state === 'critical' && (
                  <p className="mt-2 text-xs text-orange-700">Booking usage is above 95% of the monthly limit.</p>
                )}
                {bookingsUsageStatus.state === 'grace' && (
                  <p className="mt-2 text-xs text-fuchsia-700">You have reached the monthly booking limit and are using grace bookings. Upgrade now to avoid interruptions.</p>
                )}
                {bookingsUsageStatus.state === 'blocked' && (
                  <p className="mt-2 text-xs text-rose-700">Booking creation is blocked until the plan is upgraded.</p>
                )}
                {(bookingsUsageStatus.isAbovePlan || usageCounts.rooms > (usageLimits.rooms ?? Infinity) || usageCounts.users > (usageLimits.users ?? Infinity)) && (
                  <p className="mt-2 text-xs text-rose-700">
                    this property is above the {normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter')} plan limits. Existing records remain available, but new records are restricted until usage is reduced or the plan is upgraded.
                  </p>
                )}
                <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Recommendation</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{usageRecommendation.label}</p>
                  <p className="mt-1 text-xs text-slate-600">{usageRecommendation.reason || usageRecommendation.details}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{usageRecommendation.details}</p>
                  {usageRecommendation.recommendedPlan && usageRecommendation.label !== 'Best fit / Enterprise' && (
                    <button type="button" onClick={() => setUpgradeOpen(true)} className="mt-3 rounded-xl border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700">
                      Review upgrade to {usageRecommendation.recommendedPlan}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {APP_FEATURES.map((featureName) => {
                const enabled = isFeatureEnabled(featureName)
                return (
                  <div
                    key={featureName}
                    className={`rounded-2xl border p-4 ${
                      enabled ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-semibold leading-5 text-gray-800">{FEATURE_LABELS[featureName]}</p>
                        <p className="mt-1 text-xs leading-5 text-gray-500">
                          {enabled ? 'Included in the current entitlement' : entitlementExpired ? 'Locked: buy a subscription to restore access' : 'Upgrade or override required'}
                        </p>
                      </div>
                      {enabled ? (
                        <CheckCircle2 size={16} className="text-green-600 flex-shrink-0 mt-1" />
                      ) : (
                        <Lock size={16} className="text-gray-400 flex-shrink-0 mt-1" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {IS_HOTEL_PRODUCT && <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Optional hotel services</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    These optional services are quoted and activated separately for the Hotel product.
                  </p>
                </div>
                <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                  {enterpriseAddons.length} active
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {eligibleAddons.map((addon) => {
                  const enabled = isEnterpriseAddonEnabled(addon.key, enterpriseAddons)
                  const requestable = addon.status === ENTERPRISE_ADDON_STATUS.requestable
                  return (
                    <div
                      key={addon.key}
                      className={`rounded-2xl border bg-white p-3 ${
                        enabled ? 'border-green-200' : requestable ? 'border-amber-200' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{addon.label}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{addon.description}</p>
                        </div>
                        {enabled ? (
                          <CheckCircle2 size={16} className="mt-1 flex-shrink-0 text-green-600" />
                        ) : requestable ? (
                          <ArrowUpCircle size={16} className="mt-1 flex-shrink-0 text-amber-600" />
                        ) : (
                          <Clock size={16} className="mt-1 flex-shrink-0 text-slate-400" />
                        )}
                      </div>
                      <p className={`mt-3 text-xs font-semibold ${
                        enabled ? 'text-green-700' : requestable ? 'text-amber-700' : 'text-slate-500'
                      }`}>
                        {enabled ? 'Activated for this property' : requestable ? 'Available by request' : 'Planned for a later rollout'}
                      </p>
                    </div>
                  )
                })}
                {eligibleAddons.length === 0 && (
                  <p className="text-sm text-slate-500">No optional hotel services are currently relevant to this property type.</p>
                )}
              </div>
            </div>}
          </div>

        </div>

        <div className="space-y-5">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-gray-800">{IS_HOTEL_PRODUCT ? 'Hotel package' : 'Package options'}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {IS_HOTEL_PRODUCT
                    ? 'HotelOS is a separate Tsa Bonno product with a property-specific quotation.'
                    : IS_POS_PRODUCT
                      ? 'Choose the POS operating package that matches the workflows you need.'
                      : 'Starter, Standard, and Pro are the LodgingOS packages.'}
                </p>
              </div>
              <div className="inline-flex w-fit items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">
                <Sparkles size={15} />
                Current: {getCommercialPackageDisplayName({ productId: BUILD_PRODUCT.id, commercialPackageKey: currentCommercialPackageKey, plan: licenseStatus?.plan || 'Starter' })}
              </div>
            </div>

            <div className="grid gap-3">
              {commercialPackages.map((plan) => {
                const limits = IS_LODGE_PRODUCT ? formatPlanLimits(plan.internalPlan) : null
                const isCurrent = currentCommercialPackageKey
                  ? currentCommercialPackageKey === plan.commercialPackageKey
                  : normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter') === plan.internalPlan
                const isSelected = requestedPackageKey === plan.commercialPackageKey
                const isRecommended = plan.spotlight === 'Most Popular'
                const isPremium = plan.internalPlan === 'Pro'
                const isEnterprise = plan.internalPlan === 'Enterprise'
                return (
                  <button
                    key={plan.commercialPackageKey}
                    type="button"
                    onClick={() => setRequestedPackageKey(plan.commercialPackageKey)}
                    className={`rounded-2xl border p-4 text-left transition-all ${
                      isSelected
                        ? 'border-emerald-300 bg-emerald-50 shadow-sm'
                        : isRecommended
                          ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-300 hover:bg-emerald-50/70'
                          : isPremium
                            ? 'border-purple-200 bg-purple-50/40 hover:border-purple-300 hover:bg-purple-50/70'
                            : isEnterprise
                              ? 'border-indigo-200 bg-indigo-50/40 hover:border-indigo-300 hover:bg-indigo-50/70'
                              : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-800">{plan.displayName || plan.name}</p>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            {plan.badge}
                          </span>
                          {plan.spotlight && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              isRecommended
                                ? 'bg-emerald-600 text-white'
                                : 'bg-purple-600 text-white'
                            }`}>
                              {plan.spotlight}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{plan.priceLabel}</p>
                      </div>
                      {isCurrent && (
                        <span className="rounded-full bg-green-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-green-700">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-sm font-medium text-gray-800">{plan.headline}</p>
                    <p className="mt-2 text-sm text-gray-500">{plan.summary}</p>
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                      {IS_HOTEL_PRODUCT ? (
                        <p className="font-semibold text-slate-700">Configured per hotel quotation</p>
                      ) : IS_POS_PRODUCT ? (
                        <p className="font-semibold text-slate-700">Feature bundle — no Lodge &amp; Camp capacity limits</p>
                      ) : (
                        <>
                          <p className="font-semibold text-slate-700">{limits.bookings}</p>
                          <p>{limits.grace}</p>
                          <p>{limits.rooms}</p>
                          <p>{limits.users}</p>
                        </>
                      )}
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {plan.modules.slice(0, 4).map((moduleName) => (
                        <div key={moduleName} className="text-xs text-gray-600">
                          • {moduleName}
                        </div>
                      ))}
                    </div>
                    {IS_LODGE_PRODUCT && (
                      <>
                        <p className="mt-3 text-[11px] font-medium text-slate-500">{limits.bookingExplanation}</p>
                        <p className="mt-1 text-[11px] font-medium text-slate-500">{limits.graceExplanation}</p>
                        <p className="mt-1 text-[11px] font-medium text-slate-500">{limits.resetCopy}</p>
                      </>
                    )}
                    <p className="mt-4 text-xs text-gray-500">{plan.upgradeNudge}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-5">
            <h3 className="text-base font-semibold text-gray-800">Activation & Billing</h3>
            <p className="text-sm text-gray-500 mt-1">
              Activate a purchased key, review property subscription billing, or request an upgrade.
            </p>

            {canManageSubscription ? (
              <div className="space-y-4 mt-5">
                {licenseStatus?.status !== 'licensed' && (
                  <div className="rounded-2xl border border-gray-200 p-4">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Activation key</label>
                    <div className="flex gap-2 mt-2">
                      <div className="relative flex-1">
                        <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          className="input pl-8 font-mono tracking-wider uppercase"
                          placeholder="BB-XXXX-XXXX-XXXX"
                          value={licenseKey}
                          onChange={(event) => setLicenseKey(event.target.value.toUpperCase())}
                          maxLength={17}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleActivate}
                        disabled={activating || !licenseKey.trim()}
                        className="btn-primary whitespace-nowrap"
                      >
                        {activating ? 'Activating…' : 'Activate'}
                      </button>
                    </div>
                    {activateMsg && (
                      <p className={`text-sm mt-3 flex items-center gap-2 ${activateMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                        {activateMsg.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                        {activateMsg.text}
                      </p>
                    )}
                  </div>
                )}

                {!upgradeOpen ? (
                  <button
                    type="button"
                    onClick={() => setUpgradeOpen(true)}
                    className="w-full border-2 border-dashed border-green-300 text-green-700 hover:bg-green-50 font-semibold text-sm py-3 rounded-2xl transition-colors flex items-center justify-center gap-2"
                  >
                    <ArrowUpCircle size={16} />
                    Request plan upgrade
                  </button>
                ) : (
                  <div className="rounded-2xl border border-green-200 bg-green-50 p-4 space-y-3">
                    <p className="text-sm font-semibold text-green-800">Upgrade request</p>
                    {upgradeSent ? (
                      <p className="text-sm text-green-700">Request sent. Tsa Bonno will follow up shortly.</p>
                    ) : (
                      <>
                        <div className="grid gap-3 sm:grid-cols-[0.95fr_1.05fr]">
                          <div>
                            <label className="text-xs font-semibold uppercase tracking-wide text-green-800">Requested plan</label>
                            <select
                              className="input mt-2 text-sm"
                              value={requestedPackageKey}
                              onChange={(event) => setRequestedPackageKey(event.target.value)}
                            >
                              {commercialPackages.map((plan) => (
                                <option key={plan.commercialPackageKey} value={plan.commercialPackageKey}>
                                  {plan.displayName || plan.name} - {plan.headline}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="rounded-2xl border border-green-200 bg-white/75 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-green-800">
                              {selectedCommercialPackage?.displayName || getCommercialPackageDisplayName({ productId: BUILD_PRODUCT.id, commercialPackageKey: requestedPackageKey, plan: selectedCommercialPackage?.internalPlan })}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-800">{selectedCommercialPackage?.headline}</p>
                            <p className="mt-1 text-xs text-slate-500">{selectedCommercialPackage?.summary}</p>
                          </div>
                        </div>
                        <textarea
                          className="input h-24 resize-none text-sm"
                          placeholder="Optional notes: expected usage, number of outlets, reporting needs, stock control, or anything else Tsa Bonno should know…"
                          value={upgradeMsg}
                          onChange={(event) => setUpgradeMsg(event.target.value)}
                        />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setUpgradeOpen(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
                          <button type="button" onClick={handleUpgradeRequest} disabled={upgradeSending} className="btn-primary flex-1 text-sm">
                            {upgradeSending ? 'Sending…' : `Request ${selectedCommercialPackage?.displayName || 'package'}`}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mt-5">
                <p className="text-sm font-semibold text-amber-800">Subscription changes are restricted</p>
                <p className="text-sm text-amber-700 mt-1">
                  Your current role can review access, but only finance, manager, or admin-level users can activate or change the property subscription.
                </p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard size={16} className="text-green-600" />
              <h3 className="text-base font-semibold text-gray-800">Billing History</h3>
            </div>
            {!canManageSubscription ? (
              <p className="text-sm text-gray-500">Your role can view access status, but only finance, manager, or admin users can open subscription billing history.</p>
            ) : invoices.length === 0 ? (
              <p className="text-sm text-gray-500">No subscription invoices have been recorded for this property yet.</p>
            ) : (
              <div className="space-y-3">
                {invoices.slice(0, 6).map((invoice) => (
                  <div key={invoice.id} className="rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-800">{invoice.invoice_number}</p>
                        <p className="text-sm text-gray-500 mt-1">{normalizeSubscriptionPlan(invoice.package_name)}</p>
                      </div>
                      <p className="font-semibold text-gray-800">{invoice.currency} {Number(invoice.amount || 0).toFixed(2)}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Paid {fmtDate(invoice.paid_date || invoice.issued_date)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

           {IS_HOTEL_PRODUCT && <div className="bg-white rounded-2xl shadow-sm p-5">
             <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className="text-indigo-600" />
              <h3 className="text-base font-semibold text-gray-800">Hotel package</h3>
            </div>
            <p className="text-sm text-gray-500 mb-3">Need the separate Tsa Bonno HotelOS workspace or an optional hotel service? Use the Package Builder to submit a structured quotation request.</p>
            <button
              type="button"
              onClick={() => window.location.hash = '#/subscription-builder'}
              className="w-full border-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-semibold text-sm py-3 rounded-2xl transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles size={16} />
              Open Package Builder
            </button>
          </div>}

          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Hash size={16} className="text-gray-500" />
              <h3 className="text-base font-semibold text-gray-800">Installation Identity</h3>
            </div>
            <p className="text-sm text-gray-500">Share this installation ID with Tsa Bonno when requesting a new key or investigating property entitlement issues.</p>
            <div className="flex items-center gap-2 mt-4">
              <code className="flex-1 text-xs bg-gray-100 rounded-xl px-3 py-3 text-gray-600 font-mono truncate">
                {lodgeId || '—'}
              </code>
              <button
                type="button"
                onClick={copyLodgeId}
                className="p-3 bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 rounded-xl transition-colors"
                title="Copy installation ID"
              >
                {lodgeIdCopied ? <CheckCircle2 size={15} className="text-green-600" /> : <Copy size={15} />}
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
