export const ENTERPRISE_PREVIEW_STORAGE_KEY = 'boroko:enterprise-preview'
export const ENTERPRISE_PREVIEW_EVENT = 'boroko:enterprise-preview-changed'

const PREVIEW_PROPERTY_TYPE = 'hotel'
const PREVIEW_ADDONS = [
  'custom_website',
  'payment_gateway',
  'rate_plans',
  'channel_manager',
  'corporate_accounts',
  'advanced_housekeeping_mobile',
  'guest_portal',
  'multi_property',
  'advanced_rates',
  'linen_laundry',
  'lost_found',
  'incident_log',
  'visitor_register',
  'emergency_list',
  'multi_outlet_pos'
]

export function isEnterprisePreviewEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return false
  return window.localStorage.getItem(ENTERPRISE_PREVIEW_STORAGE_KEY) === 'true'
}

export function setEnterprisePreviewEnabled(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return false
  if (enabled) {
    window.localStorage.setItem(ENTERPRISE_PREVIEW_STORAGE_KEY, 'true')
  } else {
    window.localStorage.removeItem(ENTERPRISE_PREVIEW_STORAGE_KEY)
  }
  window.dispatchEvent(new CustomEvent(ENTERPRISE_PREVIEW_EVENT, { detail: { enabled: Boolean(enabled) } }))
  return true
}

export function getEffectiveUiPlan(realPlan, previewEnabled = isEnterprisePreviewEnabled()) {
  return previewEnabled ? 'Enterprise' : realPlan
}

export function getEffectiveUiPropertyType(realPropertyType, previewEnabled = isEnterprisePreviewEnabled()) {
  if (!previewEnabled) return realPropertyType
  return PREVIEW_PROPERTY_TYPE
}

export function getEffectiveUiBusinessType(realBusinessType, previewEnabled = isEnterprisePreviewEnabled()) {
  if (!previewEnabled) return realBusinessType
  return 'lodge'
}

export function getEffectiveUiAddons(realAddons = [], previewEnabled = isEnterprisePreviewEnabled()) {
  if (!previewEnabled) return Array.isArray(realAddons) ? realAddons : []
  return PREVIEW_ADDONS
}

export function buildEnterprisePreviewAccess(access) {
  if (!isEnterprisePreviewEnabled()) return access
  return {
    ...(access || {}),
    allowedByRole: new Proxy(access?.allowedByRole || {}, {
      get(target, prop) {
        if (typeof prop === 'string') return true
        return target[prop]
      }
    }),
    blockedByFeature: {}
  }
}
