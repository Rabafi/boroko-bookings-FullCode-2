import { getUsageLimitStatus, getUsageStatePresentation, isUnlimited } from '../../../../shared/subscriptionPlans'

export default function UsageLimitIndicator({ label, used = 0, limit = null, grace = 0, className = '' }) {
  const status = getUsageLimitStatus({ used, limit, grace })
  const tone = getUsageStatePresentation(status).cls
  const denominator = Number(grace || 0) > 0 && !isUnlimited(limit) ? status.effectiveLimit : limit
  const suffix = isUnlimited(limit) ? 'Unlimited access' : `${used}/${denominator}`
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${tone} ${className}`}>
      <span>{label}</span>
      <span>{suffix}</span>
      {!isUnlimited(limit) && status.state !== 'ok' && status.state !== 'unlimited' && (
        <span className="text-[10px] uppercase tracking-wide">
          {status.state === 'grace'
            ? `In grace (${status.remainingGrace} left)`
            : status.isAbovePlan
              ? 'Above plan limit'
              : status.state === 'blocked'
                ? 'Limit reached'
                : `${status.percentUsed}%`}
        </span>
      )}
    </div>
  )
}
