import { getPlanFeatureMap } from './subscriptionState.js'

export function refreshCachedTrialCountdown(entitlement, now = new Date()) {
  if (!entitlement || typeof entitlement !== 'object' || entitlement.status !== 'trial') return entitlement

  const trialEndValue = entitlement.trial_ends_at || entitlement.expires_at || entitlement.offline_valid_until || entitlement.offlineValidUntil
  const trialEnd = trialEndValue ? new Date(trialEndValue) : null
  const currentTime = now instanceof Date ? now : new Date(now)
  if (!trialEnd || !Number.isFinite(trialEnd.getTime()) || !Number.isFinite(currentTime.getTime())) return entitlement

  const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - currentTime.getTime()) / 86_400_000))
  const expired = daysLeft <= 0
  return {
    ...entitlement,
    status: expired ? 'expired' : 'trial',
    daysLeft,
    expired,
    plan: expired ? null : 'Trial',
    payment_status: expired ? 'expired' : 'trial',
    subscription_state: expired ? 'expired' : 'trial',
    expires_at: expired ? trialEnd.toISOString() : entitlement.expires_at || null,
    effective_features: getPlanFeatureMap('Pro', { trial: !expired, expired })
  }
}
