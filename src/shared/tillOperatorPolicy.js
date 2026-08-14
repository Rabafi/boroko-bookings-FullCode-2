/**
 * Till operator verification policy.
 *
 * Strict is intentionally the fail-closed default. Shift mode is an explicit
 * manager setting for shared bar terminals and still keeps every sale tied to
 * the PIN-verified operator.
 */
export const TILL_OPERATOR_MODES = Object.freeze({
  STRICT: 'strict',
  SHIFT: 'shift'
})

export const DEFAULT_TILL_OPERATOR_MODE = TILL_OPERATOR_MODES.STRICT
export const DEFAULT_TILL_OPERATOR_INACTIVITY_MINUTES = 30
export const MIN_TILL_OPERATOR_INACTIVITY_MINUTES = 5
export const MAX_TILL_OPERATOR_INACTIVITY_MINUTES = 240

function asObject(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' ? value : {}
}

export function normalizeTillOperatorMode(value) {
  return String(value || '').trim().toLowerCase() === TILL_OPERATOR_MODES.SHIFT
    ? TILL_OPERATOR_MODES.SHIFT
    : DEFAULT_TILL_OPERATOR_MODE
}

export function normalizeTillOperatorInactivityMinutes(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_TILL_OPERATOR_INACTIVITY_MINUTES
  return Math.min(
    MAX_TILL_OPERATOR_INACTIVITY_MINUTES,
    Math.max(MIN_TILL_OPERATOR_INACTIVITY_MINUTES, Math.round(numeric))
  )
}

export function normalizeTillOperatorPolicy(policy = {}) {
  const source = asObject(policy)
  return {
    mode: normalizeTillOperatorMode(source.mode),
    inactivityMinutes: normalizeTillOperatorInactivityMinutes(
      source.inactivity_minutes ?? source.inactivityMinutes
    )
  }
}

/**
 * Read policy from either the settings row or an operating_profile object.
 * Missing/invalid values deliberately resolve to strict mode.
 */
export function getTillOperatorPolicy(settingsOrProfile = {}) {
  const root = asObject(settingsOrProfile)
  const profile = asObject(root.operating_profile || root)
  return normalizeTillOperatorPolicy(
    profile.till_operator_policy || root.till_operator_policy || {}
  )
}

export function tillOperatorPolicyToProfileValue(policy = {}) {
  const normalized = normalizeTillOperatorPolicy(policy)
  return {
    mode: normalized.mode,
    inactivity_minutes: normalized.inactivityMinutes
  }
}
