// @ts-check
import { COMMERCIAL_PRODUCT_IDS, getCommercialAddon, getCommercialOffer } from './commercialEntitlements.js'

/** @import {CommercialProductId} from './commercialEntitlements.js' */

/** @type {Readonly<Record<string, string>>} */
const COMMERCIAL_FEATURE_ALIASES = Object.freeze({
  restaurant_service: 'tables',
  restaurant_control: 'stock_control',
  restaurant_growth: 'loyalty',
  multi_outlet_pos: 'multi_outlet_controls',
  guest_crm: 'customer_accounts',
  guest_crm_view: 'customer_accounts',
  guest_crm_manage: 'customer_accounts'
})

/** @type {Set<string>} */
const ACCESSIBLE_COMMERCIAL_STATUSES = new Set([
  'licensed',
  'trial',
  'active',
  'grace_period'
])

/** @type {Set<string>} */
const ACCESSIBLE_SUBSCRIPTION_STATES = new Set([
  'active',
  'trial',
  'grace_period'
])

/** @type {Set<string>} */
const DENIED_COMMERCIAL_STATES = new Set([
  'expired',
  'suspended',
  'cancelled',
  'inactive',
  'offline_lease_expired',
  'revoked'
])

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** @param {unknown} value @param {string} key @returns {unknown} */
function readOptionalField(value, key) {
  return value === null || value === undefined
    ? undefined
    : Reflect.get(Object(value), key, value)
}

/** @param {unknown} value @returns {Date} */
function dateFromUnknown(value) {
  // Reflect.construct with the built-in Date constructor returns a Date while
  // preserving Date's coercion and error behavior for the untrusted input.
  return /** @type {Date} */ (Reflect.construct(Date, [value]))
}

/** @param {unknown} productId @returns {string} */
function normalizeProductId(productId) {
  return String(productId || '').trim().toLowerCase()
}

/** @param {unknown} featureKey @returns {string} */
function normalizeFeatureKey(featureKey) {
  const feature = String(featureKey || '').trim().toLowerCase()
  return COMMERCIAL_FEATURE_ALIASES[feature] || feature
}

/**
 * An entitlement returned by get_lodge_entitlement is usable for local
 * commercial decisions only when its product and access state are explicit.
 * This deliberately does not accept settings rows, a generic Pro plan, or a
 * snapshot from another executable. Server/RBAC/outlet checks remain the
 * final authority for every action.
 */
/** @param {unknown} entitlement @param {unknown} expectedProductId @param {string | null} [expectedPackageKey] @param {string | null} [expectedLodgeId] */
export function isCommercialEntitlementContextValid(entitlement, expectedProductId, expectedPackageKey = null, expectedLodgeId = null) {
  if (!isPlainRecord(entitlement)) return false

  const productId = normalizeProductId(expectedProductId)
  if (!productId || normalizeProductId(entitlement.product_id) !== productId) return false
  if (entitlement.expired === true) return false

  // Tenant/session binding: when the caller knows the active lodge, the
  // entitlement must carry that same lodge identity. A different lodge_id
  // never authorizes the session, and a MISSING lodge_id is equally
  // rejected: legacy snapshots without tenant provenance must come through
  // the trusted fetch/cache adapter (which stamps the requested lodge after
  // verifying RPC scope, or binds single-profile legacy disk snapshots) or
  // be refreshed — renderer guesswork never fills the gap.
  if (expectedLodgeId !== null && expectedLodgeId !== undefined && String(expectedLodgeId).trim() !== '') {
    const expectedLodge = String(expectedLodgeId).trim().toLowerCase()
    const actualLodge = entitlement.lodge_id === null || entitlement.lodge_id === undefined || String(entitlement.lodge_id).trim() === ''
      ? null
      : String(entitlement.lodge_id).trim().toLowerCase()
    if (actualLodge === null || actualLodge !== expectedLodge) return false
  }

  const status = String(entitlement.status || '').trim().toLowerCase()
  const subscriptionState = String(entitlement.subscription_state || '').trim().toLowerCase()
  // Do not let a stale/contradictory positive field (for example
  // subscription_state: active) override an explicit denial from the server.
  if (DENIED_COMMERCIAL_STATES.has(status) || DENIED_COMMERCIAL_STATES.has(subscriptionState)) return false
  if (!ACCESSIBLE_COMMERCIAL_STATUSES.has(status) && !ACCESSIBLE_SUBSCRIPTION_STATES.has(subscriptionState)) {
    return false
  }

  // The online RPC and the offline lease cache both expose this boundary.
  // A malformed timestamp is treated as untrusted instead of granting access.
  if (entitlement.offline_valid_until !== undefined && entitlement.offline_valid_until !== null) {
    const offlineValidUntil = dateFromUnknown(entitlement.offline_valid_until)
    if (!Number.isFinite(offlineValidUntil.getTime()) || offlineValidUntil.getTime() <= Date.now()) return false
  }

  // A normal licensed/trial snapshot cannot carry an already-expired licence.
  // Grace-period access is represented by subscription_state and is retained.
  if (entitlement.expires_at !== undefined && entitlement.expires_at !== null) {
    const expiresAt = dateFromUnknown(entitlement.expires_at)
    if (!Number.isFinite(expiresAt.getTime())) return false
    if (expiresAt.getTime() <= Date.now() && subscriptionState !== 'grace_period') return false
  }

  const entitlementPackageKey = String(entitlement.commercial_package_key || '').trim().toLowerCase()
  const packageKey = String(expectedPackageKey || '').trim().toLowerCase()
  if (productId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS
    && (!packageKey || !entitlementPackageKey || entitlementPackageKey !== packageKey)) return false
  if (entitlementPackageKey && packageKey && entitlementPackageKey !== packageKey) return false
  return true
}

/**
 * Read only the explicit, product-scoped override map emitted by the
 * authoritative entitlement RPC. effective_features is intentionally not
 * consulted here: POS licences use an internal Pro compatibility plan and
 * that generic map is not a complete add-on entitlement.
 *
 * @returns {boolean|null} true/false for an explicit active override, null
 * when there is no trusted override for this feature.
 */
/** @param {unknown} entitlement @param {unknown} expectedProductId @param {string} featureKey @param {string | null} [expectedPackageKey] @param {string | null} [expectedLodgeId] @returns {boolean | null} */
export function getCommercialFeatureOverride(entitlement, expectedProductId, featureKey, expectedPackageKey = null, expectedLodgeId = null) {
  if (!isCommercialEntitlementContextValid(entitlement, expectedProductId, expectedPackageKey, expectedLodgeId)) return null
  if (!isPlainRecord(entitlement)) return null

  const overrides = entitlement.commercial_overrides
  if (!isPlainRecord(overrides) || !isPlainRecord(overrides.features)) return null

  const normalizedFeature = normalizeFeatureKey(featureKey)
  if (!normalizedFeature) return null
  // Conflicting aliases (e.g. restaurant_service:true with tables:false) fail
  // closed to an explicit denial so single-feature and set decisions agree.
  // Non-boolean entries are untrusted and ignored.
  const matches = Object.entries(overrides.features)
    .filter(([key]) => normalizeFeatureKey(key) === normalizedFeature)
    .map(([, value]) => value)
    .filter((value) => typeof value === 'boolean')
  if (matches.length === 0) return null
  if (new Set(matches).size > 1) return false
  return matches[0]
}

/**
 * Commercial package checks are deliberately separate from legacy plan checks.
 * POS packages all remain internally compatible with Pro, but their package key
 * is the runtime boundary for restaurant capabilities. A trusted explicit
 * override is evaluated before that package boundary; no other entitlement
 * field can manufacture a feature.
 */
/** @param {unknown} productId @param {string | null} commercialPackageKey @param {string} featureKey @param {unknown} [selectedAddonKeys] @param {unknown} [commercialEntitlement] @param {string | null} [expectedLodgeId] */
export function isCommercialFeatureIncluded(productId, commercialPackageKey, featureKey, selectedAddonKeys = [], commercialEntitlement = null, expectedLodgeId = null) {
  const normalizedProductId = normalizeProductId(productId)
  if (normalizedProductId !== COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS) return true

  const normalizedFeature = normalizeFeatureKey(featureKey)
  if (!normalizedFeature) return true

  // An override can only affect a known package in this executable's local
  // catalogue. This prevents a malformed/unknown package context from using
  // an otherwise well-shaped override map to manufacture a feature.
  const offer = getCommercialOffer(normalizedProductId, commercialPackageKey)
  if (!offer) return false

  if (commercialEntitlement !== null) {
    if (!isCommercialEntitlementContextValid(commercialEntitlement, normalizedProductId, commercialPackageKey, expectedLodgeId)) return false
    const override = getCommercialFeatureOverride(commercialEntitlement, normalizedProductId, normalizedFeature, commercialPackageKey, expectedLodgeId)
    if (override !== null) return override
    // A POS entitlement without an explicit package is not an executable
    // commercial context. Keep the local decision fail-closed.
    if (!commercialPackageKey) return false
  } else if (!commercialPackageKey) {
    // A missing POS package cannot establish a paid commercial boundary.
    return false
  }

  if (offer.includedFeatures.includes(normalizedFeature)) return true
  return [...new Set(Array.isArray(selectedAddonKeys) ? selectedAddonKeys : [])].some((addonKey) => {
    const addon = getCommercialAddon(normalizedProductId, addonKey)
    const eligible = !addon?.eligiblePackageKeys || addon.eligiblePackageKeys.includes(commercialPackageKey)
    return eligible && addon?.includedFeatures?.includes(normalizedFeature) === true
  })
}

/** @param {string | null} productId @param {string | null} commercialPackageKey @param {string[]} [selectedAddonKeys] @param {unknown} [commercialEntitlement] @param {string | null} [expectedLodgeId] @returns {Set<string>} */
export function getCommercialFeatureSet(productId, commercialPackageKey, selectedAddonKeys = [], commercialEntitlement = null, expectedLodgeId = null) {
  const normalizedProductId = normalizeProductId(productId)
  if (normalizedProductId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS && commercialEntitlement !== null) {
    if (!isCommercialEntitlementContextValid(commercialEntitlement, normalizedProductId, commercialPackageKey, expectedLodgeId)) return new Set()
  }
  // Keep the catalog's ordinary property lookup semantics. In particular,
  // inherited keys such as "constructor" reach getCommercialOffers and retain
  // its existing failure behavior; this assertion only satisfies that helper's
  // declared product-ID input and does not validate the caller's value.
  const offer = getCommercialOffer(/** @type {CommercialProductId} */ (normalizedProductId), commercialPackageKey)
  if (normalizedProductId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS && !offer) return new Set()
  const features = new Set(offer?.includedFeatures || [])
  for (const addonKey of [...new Set(Array.isArray(selectedAddonKeys) ? selectedAddonKeys : [])]) {
    const addon = getCommercialAddon(/** @type {CommercialProductId} */ (normalizedProductId), addonKey)
    if (!addon?.eligiblePackageKeys || addon.eligiblePackageKeys.some((key) => key === commercialPackageKey)) {
      addon?.includedFeatures?.forEach((feature) => features.add(feature))
    }
  }

  // Preserve optional property reads, including inherited commercial_overrides.
  const overrides = readOptionalField(
    readOptionalField(commercialEntitlement, 'commercial_overrides'),
    'features',
  )
  if (normalizedProductId === COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS && isPlainRecord(overrides)) {
    // Group by normalized key so conflicting aliases fail closed consistently
    // with getCommercialFeatureOverride (deny wins over last-write-wins).
    /** @type {Map<string, Set<boolean>>} */
    const grouped = new Map()
    for (const [featureKey, enabled] of Object.entries(overrides)) {
      if (typeof enabled !== 'boolean') continue
      const normalizedFeature = normalizeFeatureKey(featureKey)
      if (!normalizedFeature) continue
      let values = grouped.get(normalizedFeature)
      if (!values) {
        values = new Set()
        grouped.set(normalizedFeature, values)
      }
      values.add(enabled)
    }
    for (const [normalizedFeature, values] of grouped) {
      if (values.size > 1) {
        features.delete(normalizedFeature)
        continue
      }
      if (values.has(true)) features.add(normalizedFeature)
      else features.delete(normalizedFeature)
    }
  }
  return features
}

/** @param {CommercialProductId} productId @param {string | null} commercialPackageKey */
export function isCommercialPackageSelected(productId, commercialPackageKey) {
  return Boolean(getCommercialOffer(productId, commercialPackageKey))
}
