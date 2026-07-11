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
  getAllSubscriptionPlans,
  getFeatureRequiredPlan,
  getPlanRecommendation,
  getPlanUsageLimits,
  getSubscriptionPlan,
  getUsageLimitStatus,
  formatPlanLimits,
  normalizeSubscriptionPlan,
  buildUpgradeRequestDescription
} from '../../../shared/subscriptionPlans'
import {
  ENTERPRISE_ADDON_STATUS,
  getEligibleEnterpriseAddons,
  isEnterpriseAddonEnabled
} from '../../../shared/enterpriseAddons'
import UsageLimitIndicator from './shared/UsageLimitIndicator'

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
  const planLabel = licensed ? normalizeSubscriptionPlan(licenseStatus.plan || 'Starter') : 'Trial'
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
                ? 'Access is paused until the lodge is activated'
                : `${licenseStatus.daysLeft || 0} day${licenseStatus.daysLeft === 1 ? '' : 's'} left in trial`}
          </h2>
          <p className="text-sm text-white/85 mt-2">
            {licensed
              ? subscriptionState === 'grace_period'
                ? 'This lodge is still running, but it is inside a grace period. Boroko will protect access until the grace window ends.'
                : 'This lodge is currently licensed and Boroko will use this entitlement as the source of truth for modules and access.'
              : expired
                ? subscriptionState === 'offline_lease_expired'
                  ? 'The device stayed offline beyond its safe entitlement window. Reconnect and refresh the subscription to restore premium access.'
                  : 'This trial has ended. Buy and activate a subscription to restore app features for this lodge.'
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
  const [requestedPlan, setRequestedPlan] = useState('Standard')
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
  const hasUsageLimits = !isProPlan && !isEnterprisePlan
  const licensedPlanIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(licensedPlan)
  const enterpriseAddons = Array.isArray(licenseStatus?.enterprise_addons)
    ? licenseStatus.enterprise_addons
    : Array.isArray(access?.entitlement?.enterprise_addons)
      ? access.entitlement.enterprise_addons
      : []
  const propertyType = settings?.property_type || settings?.business_type || 'lodge'
  const eligibleAddons = useMemo(
    () => getEligibleEnterpriseAddons(propertyType),
    [propertyType]
  )

  const isFeatureEnabled = (featureName) => {
    if (entitlementExpired) return false
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
    setRequestedPlan(getRecommendedUpgradePlan(licenseStatus?.plan))
  }, [licenseStatus?.plan])

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
  const usageRecommendation = getPlanRecommendation({
    plan: licenseStatus?.plan || 'Starter',
    bookingsUsage: usageCounts.monthlyBookings,
    roomsUsage: usageCounts.rooms,
    usersUsage: usageCounts.users,
    limits: usageLimits
  })

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
      await window.api.admin.createSupportTicket({
        lodge_id: lodgeId || 'unknown',
        lodge_name: lodgeName,
        title: `Upgrade Request — ${requestedPlan} Plan`,
        description: buildUpgradeRequestDescription({
          lodgeName,
          currentPlan: licenseStatus?.plan || 'Starter',
          requestedPlan,
          notes: upgradeMsg
        }),
        category: 'Upgrade Request',
        priority: 'High'
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
                  {enabledFeatures.length} of {APP_FEATURES.length} controlled modules currently unlocked for this lodge.
                </p>
              </div>
              <div className="inline-flex w-fit items-center gap-2 bg-green-50 text-green-700 px-3 py-2 rounded-xl text-sm font-semibold">
                <Sparkles size={15} />
                {licenseStatus?.status === 'licensed' ? normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter') : 'Trial'}
              </div>
            </div>

            {isProPlan ? (
              <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Usage</p>
                <p className="mt-2 text-sm font-semibold text-emerald-800">Unlimited access</p>
                <p className="mt-1 text-xs text-emerald-700">No usage counters or warning bars are shown for Pro.</p>
              </div>
            ) : isEnterprisePlan ? (
              <div className="mb-4 rounded-2xl border border-purple-200 bg-purple-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">Usage</p>
                <p className="mt-2 text-sm font-semibold text-purple-800">Enterprise plan</p>
                <p className="mt-1 text-xs text-purple-700">Hotel-grade operations with capacity packs available for additional rooms, users, and bookings.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <UsageLimitIndicator label="Bookings this month" used={usageCounts.monthlyBookings} limit={usageLimits.monthlyBookings} grace={usageLimits.monthlyBookingsGrace} />
                  <UsageLimitIndicator label="Rooms" used={usageCounts.rooms} limit={usageLimits.rooms} />
                  <UsageLimitIndicator label="Users" used={usageCounts.users} limit={usageLimits.users} />
                </div>
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
                    This lodge is above the {normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter')} plan limits. Existing records remain available, but new records are restricted until usage is reduced or the plan is upgraded.
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

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Enterprise Add-ons</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    Add-ons require Enterprise plus explicit activation. They are not unlocked just because the lodge is on Enterprise.
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
                        {enabled ? 'Activated for this lodge' : requestable ? 'Available by request' : 'Planned for a later rollout'}
                      </p>
                    </div>
                  )
                })}
                {eligibleAddons.length === 0 && (
                  <p className="text-sm text-slate-500">No Enterprise add-ons are currently relevant to this property type.</p>
                )}
              </div>
            </div>
          </div>

        </div>

        <div className="space-y-5">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-gray-800">Plan Options</h3>
                <p className="text-sm text-gray-500 mt-1">
                  A clear commercial ladder for selling Boroko and giving each lodge an obvious next step.
                </p>
              </div>
              <div className="inline-flex w-fit items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">
                <Sparkles size={15} />
                Current: {normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter')}
              </div>
            </div>

            <div className="grid gap-3">
              {getAllSubscriptionPlans().map((plan) => {
                const limits = formatPlanLimits(plan.name)
                const isCurrent = normalizeSubscriptionPlan(licenseStatus?.plan || 'Starter') === plan.name
                const isSelected = requestedPlan === plan.name
                const isRecommended = plan.spotlight === 'Most Popular'
                const isPremium = plan.name === 'Pro'
                const isEnterprise = plan.name === 'Enterprise'
                return (
                  <button
                    key={plan.name}
                    type="button"
                    onClick={() => setRequestedPlan(plan.name)}
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
                          <p className="font-semibold text-gray-800">{plan.name}</p>
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
                      <p className="font-semibold text-slate-700">{limits.bookings}</p>
                      <p>{limits.grace}</p>
                      <p>{limits.rooms}</p>
                      <p>{limits.users}</p>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {plan.modules.slice(0, 4).map((moduleName) => (
                        <div key={moduleName} className="text-xs text-gray-600">
                          • {moduleName}
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] font-medium text-slate-500">{limits.bookingExplanation}</p>
                    <p className="mt-1 text-[11px] font-medium text-slate-500">{limits.graceExplanation}</p>
                    <p className="mt-1 text-[11px] font-medium text-slate-500">{limits.resetCopy}</p>
                    <p className="mt-4 text-xs text-gray-500">{plan.upgradeNudge}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-5">
            <h3 className="text-base font-semibold text-gray-800">Activation & Billing</h3>
            <p className="text-sm text-gray-500 mt-1">
              Activate a purchased key, review lodge subscription billing, or request an upgrade.
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
                      <p className="text-sm text-green-700">Request sent. Boroko will follow up shortly.</p>
                    ) : (
                      <>
                        <div className="grid gap-3 sm:grid-cols-[0.95fr_1.05fr]">
                          <div>
                            <label className="text-xs font-semibold uppercase tracking-wide text-green-800">Requested plan</label>
                            <select
                              className="input mt-2 text-sm"
                              value={requestedPlan}
                              onChange={(event) => setRequestedPlan(event.target.value)}
                            >
                              {SUBSCRIPTION_PLAN_ORDER.map((planName) => (
                                <option key={planName} value={planName}>
                                  {planName} - {getSubscriptionPlan(planName).headline}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="rounded-2xl border border-green-200 bg-white/75 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-green-800">
                              {getSubscriptionPlan(requestedPlan).badge}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-800">{getSubscriptionPlan(requestedPlan).headline}</p>
                            <p className="mt-1 text-xs text-slate-500">{getSubscriptionPlan(requestedPlan).summary}</p>
                          </div>
                        </div>
                        <textarea
                          className="input h-24 resize-none text-sm"
                          placeholder="Optional notes: expected usage, number of outlets, reporting needs, stock control, or anything else Boroko should know…"
                          value={upgradeMsg}
                          onChange={(event) => setUpgradeMsg(event.target.value)}
                        />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setUpgradeOpen(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
                          <button type="button" onClick={handleUpgradeRequest} disabled={upgradeSending} className="btn-primary flex-1 text-sm">
                            {upgradeSending ? 'Sending…' : `Request ${requestedPlan}`}
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
                  Your current role can review access, but only finance, manager, or admin-level users can activate or change the lodge subscription.
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
              <p className="text-sm text-gray-500">No subscription invoices have been recorded for this lodge yet.</p>
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

          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className="text-indigo-600" />
              <h3 className="text-base font-semibold text-gray-800">Enterprise Upgrade</h3>
            </div>
            <p className="text-sm text-gray-500 mb-3">Need more capacity or Enterprise hotel features? Use the Package Builder to select your target plan, choose add-ons, and submit a structured request.</p>
            <button
              type="button"
              onClick={() => window.location.hash = '#/subscription-builder'}
              className="w-full border-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-semibold text-sm py-3 rounded-2xl transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles size={16} />
              Open Package Builder
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Hash size={16} className="text-gray-500" />
              <h3 className="text-base font-semibold text-gray-800">Installation Identity</h3>
            </div>
            <p className="text-sm text-gray-500">Share this installation ID with Boroko when requesting a new key or investigating lodge entitlement issues.</p>
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
