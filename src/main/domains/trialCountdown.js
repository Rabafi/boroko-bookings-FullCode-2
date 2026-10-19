// @ts-check
import { getPlanFeatureMap } from './subscriptionState.js'

/** @param {unknown} value @param {string} key @returns {unknown} */
function readOptionalField(value, key) {
  if (value === null || value === undefined) return undefined
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} value @returns {Record<PropertyKey, unknown>} */
function spreadEnumerableProperties(value) {
  /** @type {Record<PropertyKey, unknown>} */
  const copy = {}
  if (value === null || value === undefined) return copy
  const source = Object(value)
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (descriptor?.enumerable) {
      Object.defineProperty(copy, key, {
        value: Reflect.get(source, key, source),
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
  }
  return copy
}

/**
 * `new Date(value)` intentionally applies JavaScript's normal coercion to
 * persisted cache data. Reflect.construct has the same Date constructor
 * semantics and its standard-library return is narrowed to the Date instance
 * the built-in creates; it does not validate the input or its resulting time.
 * @param {unknown} value
 * @returns {Date}
 */
function dateFromRuntimeValue(value) {
  return /** @type {Date} */ (Reflect.construct(Date, [value]))
}

/** @param {unknown} entitlement @param {unknown} [now] @returns {unknown} */
export function refreshCachedTrialCountdown(entitlement, now = new Date()) {
  if (!entitlement || typeof entitlement !== 'object' || readOptionalField(entitlement, 'status') !== 'trial') return entitlement

  const trialEndValue = readOptionalField(entitlement, 'trial_ends_at') || readOptionalField(entitlement, 'expires_at') || readOptionalField(entitlement, 'offline_valid_until') || readOptionalField(entitlement, 'offlineValidUntil')
  const trialEnd = trialEndValue ? dateFromRuntimeValue(trialEndValue) : null
  const currentTime = now instanceof Date ? now : dateFromRuntimeValue(now)
  if (!trialEnd || !Number.isFinite(trialEnd.getTime()) || !Number.isFinite(currentTime.getTime())) return entitlement

  const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - currentTime.getTime()) / 86_400_000))
  const expired = daysLeft <= 0
  return {
    ...spreadEnumerableProperties(entitlement),
    status: expired ? 'expired' : 'trial',
    daysLeft,
    expired,
    plan: expired ? null : 'Trial',
    payment_status: expired ? 'expired' : 'trial',
    subscription_state: expired ? 'expired' : 'trial',
    expires_at: expired ? trialEnd.toISOString() : readOptionalField(entitlement, 'expires_at') || null,
    effective_features: getPlanFeatureMap('Pro', { trial: !expired, expired })
  }
}
