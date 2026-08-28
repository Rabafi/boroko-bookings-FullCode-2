import { CheckCircle2, Sparkles, TrendingUp } from 'lucide-react'
import {
  formatPlanLimits,
  getEarlyUpgradePromptState,
  getPlanUsageLimits,
  getUsageLimitStatus,
  getUsageStatePresentation,
  isUnlimited,
  trackUpgradeIntent,
  normalizeSubscriptionPlan
} from '../../../../shared/subscriptionPlans'
import { getProductDefinition, getRuntimeProductId } from '../../../../shared/productIdentity'

const BUILD_PRODUCT = getProductDefinition(getRuntimeProductId())
const IS_CAPACITYLESS_PRODUCT = BUILD_PRODUCT.id === 'hotel' || BUILD_PRODUCT.id === 'hospitality-pos'

export default function DashboardUsageCard({
  plan = 'Starter',
  usage = {},
  status = null,
  onUpgrade,
  lodgeId = '',
  lodgeName = '',
  recommendation = null,
  trigger = 'dashboard'
} = {}) {
  const currentPlan = normalizeSubscriptionPlan(plan)
  if (IS_CAPACITYLESS_PRODUCT) {
    return (
      <section className="bb-card overflow-hidden border border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Product access</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              {BUILD_PRODUCT.id === 'hotel' ? 'Hotel Core' : 'Commercial POS'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {BUILD_PRODUCT.id === 'hotel'
                ? 'Configured through Hotel Core and optional services.'
                : 'Feature-bundle access with no LodgingOS capacity limits.'}
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
            <CheckCircle2 size={14} className="mr-1" />
            Package access enabled
          </span>
        </div>
      </section>
    )
  }
  const limits = getPlanUsageLimits(currentPlan)
  const currentLimits = formatPlanLimits(currentPlan)
  const bookingsUsed = Number(usage?.monthlyBookings ?? 0)
  const roomsUsed = Number(usage?.rooms ?? 0)
  const usersUsed = Number(usage?.users ?? 0)
  const bookingStatus = status || getUsageLimitStatus({
    used: bookingsUsed,
    limit: limits.monthlyBookings,
    grace: limits.monthlyBookingsGrace
  })
  const stateMeta = getUsageStatePresentation(bookingStatus)
  const earlyPrompt = getEarlyUpgradePromptState({
    plan: currentPlan,
    bookingsUsage: bookingsUsed,
    roomsUsage: roomsUsed,
    usersUsage: usersUsed,
    limits
  })
  const usageNote = status?.isBlocked
    ? 'New bookings are currently blocked until you upgrade.'
    : status?.isInGrace
      ? 'You’re using your grace allowance. New bookings will soon be blocked.'
      : earlyPrompt.metric
        ? `${earlyPrompt.metric.charAt(0).toUpperCase()}${earlyPrompt.metric.slice(1)} are nearing plan limits.`
        : currentLimits.bookingExplanation

  const handleUpgrade = async () => {
    trackUpgradeIntent({
      lodgeId,
      lodgeName,
      plan: currentPlan,
      usage: {
        bookings: bookingsUsed,
        rooms: roomsUsed,
        users: usersUsed
      },
      recommendation,
      trigger
    })
    if (typeof onUpgrade === 'function') {
      await onUpgrade()
    }
  }

  const usageRows = [
    { label: 'Bookings', used: bookingsUsed, limit: limits.monthlyBookings, suffix: limits.monthlyBookingsGrace ? ` +${limits.monthlyBookingsGrace} grace` : '' },
    { label: 'Rooms', used: roomsUsed, limit: limits.rooms },
    { label: 'Users', used: usersUsed, limit: limits.users }
  ]

  return (
    <section className="bb-card overflow-hidden border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Plan</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">{currentPlan}</h2>
          <p className="mt-1 text-sm text-slate-500">{currentLimits.bookings}</p>
        </div>
        <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${stateMeta.cls}`}>
          {stateMeta.label}
        </span>
      </div>

      <div className="grid gap-3 border-t border-slate-100 px-5 py-4 sm:grid-cols-3">
        {usageRows.map((row) => {
          const denominator = isUnlimited(row.limit) ? '∞' : row.limit
          const percent = isUnlimited(row.limit) || !row.limit ? 0 : Math.round((row.used / row.limit) * 100)
          return (
            <div key={row.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</p>
              <p className="mt-1 text-base font-semibold text-slate-900">
                {row.used} / {denominator}
                {row.suffix || ''}
              </p>
              <p className="mt-1 text-xs text-slate-500">{row.label === 'Bookings' ? `${percent}% used` : 'Current usage'}</p>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">Usage resets on the 1st of each month</p>
          <p className="mt-1 text-xs text-slate-500">
            {usageNote}
          </p>
        </div>
        {typeof onUpgrade === 'function' && (
          <button
            type="button"
            onClick={handleUpgrade}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            <Sparkles size={15} />
            Upgrade Plan
          </button>
        )}
      </div>
    </section>
  )
}
