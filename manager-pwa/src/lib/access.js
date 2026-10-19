// @ts-check
import {
  CAPABILITY_LABELS,
  FEATURE_LABELS,
  ROLE_DEFINITIONS,
  buildCapabilitySnapshot,
  normalizeAppRole,
  normalizeStaffStatus
} from '@shared/accessControl'
import { getSession, readLocalJson, writeLocalJson } from './runtime'

const ACCESS_PREFIX = 'boroko_pwa_access'
const ENTITLEMENT_PREFIX = 'boroko_pwa_entitlement'

/** @typedef {Record<string, unknown>} UnknownRecord */
/** @typedef {{id: unknown, name: unknown, email: string, role: unknown, status: unknown, lodge_id: string, lodge_display_name: unknown, property_type: string | null, product_family: string | null, product_family_label: unknown, product_id: unknown, commercial_package_key: unknown, package_label: unknown, hospitality_mode: unknown, pwa_plan: unknown, effective_features: unknown, capability_overrides: unknown}} NormalizedSessionUser */
/**
 * The implementation passes these identity fields through to commercial
 * access helpers without validating them. Keep that existing permissive call
 * boundary here while the shared public contract describes canonical IDs.
 * @type {(input: {role: unknown, features: unknown, capabilityOverrides: unknown, productId: unknown, commercialPackageKey: unknown, commercialAddonKeys: unknown}) => {capabilities: Record<string, boolean>, [key: string]: unknown}}
 */
const buildCapabilitySnapshotForAccess = /** @type {(input: {role: unknown, features: unknown, capabilityOverrides: unknown, productId: unknown, commercialPackageKey: unknown, commercialAddonKeys: unknown}) => {capabilities: Record<string, boolean>, [key: string]: unknown}} */ (buildCapabilitySnapshot)

/** @param {unknown} value @param {string} key @returns {unknown} */
function readField(value, key) {
  if (value === null || value === undefined) return undefined
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} value @param {string} key @returns {unknown} */
function readDirectField(value, key) {
  if (value === null || value === undefined) {
    throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`)
  }
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} prefix @param {unknown} lodgeId @returns {string} */
function scoped(prefix, lodgeId) {
  return `${prefix}:${String(lodgeId || 'global').trim().toLowerCase()}`
}

/** @param {unknown} [rawRow] @returns {NormalizedSessionUser} */
export function normalizeSessionUser(rawRow = {}) {
  const productFamily = String(readDirectField(rawRow, 'product_family') || '').trim().toLowerCase() || null
  const propertyType = String(readDirectField(rawRow, 'property_type') || '').trim().toLowerCase() || null
  return {
    id: readDirectField(rawRow, 'id') || readDirectField(rawRow, 'user_id') || readDirectField(rawRow, 'manager_id') || '',
    name: readDirectField(rawRow, 'name') || readDirectField(rawRow, 'user_name') || 'Tsa Bonno User',
    email: String(readDirectField(rawRow, 'email') || '').trim().toLowerCase(),
    role: normalizeAppRole(readDirectField(rawRow, 'role') || 'manager'),
    status: normalizeStaffStatus(readDirectField(rawRow, 'status')),
    lodge_id: String(readDirectField(rawRow, 'lodge_id') || '').trim().toLowerCase(),
    lodge_display_name: readDirectField(rawRow, 'lodge_display_name') || readDirectField(rawRow, 'lodge_name') || readDirectField(rawRow, 'company_name') || 'Your Lodge',
    // Server-authoritative product identity — never invent from a client mode choice.
    property_type: propertyType,
    product_family: productFamily,
    product_family_label: readDirectField(rawRow, 'product_family_label') || null,
    product_id: readDirectField(rawRow, 'product_id') || null,
    commercial_package_key: readDirectField(rawRow, 'commercial_package_key') || null,
    package_label: readDirectField(rawRow, 'package_label') || null,
    hospitality_mode: readDirectField(rawRow, 'hospitality_mode') || null,
    pwa_plan: readDirectField(rawRow, 'pwa_plan') || readDirectField(rawRow, 'plan') || null,
    effective_features:
      readDirectField(rawRow, 'effective_features') && typeof readDirectField(rawRow, 'effective_features') === 'object' && !Array.isArray(readDirectField(rawRow, 'effective_features'))
        ? readDirectField(rawRow, 'effective_features')
        : null,
    capability_overrides:
      readDirectField(rawRow, 'capability_overrides') && typeof readDirectField(rawRow, 'capability_overrides') === 'object' && !Array.isArray(readDirectField(rawRow, 'capability_overrides'))
        ? readDirectField(rawRow, 'capability_overrides')
        : {}
  }
}

/** @param {unknown} user @param {unknown} [features] */
export function buildAccessSnapshot(user, features = {}) {
  const snapshot = buildCapabilitySnapshotForAccess({
    role: normalizeAppRole(readField(user, 'role')),
    features,
    capabilityOverrides: readField(user, 'capability_overrides') || {},
    // The implementation passes these identity values through without
    // validation, so preserve their raw values at this call boundary.
    productId: readField(user, 'product_id') || null,
    commercialPackageKey: readField(user, 'commercial_package_key') || null,
    commercialAddonKeys: readField(user, 'commercial_addon_keys') || []
  })

  const blockedOnMobile = new Set([
    'bookings.manage',
    'payments.record',
    'payments.refund',
    'prepayments.receive',
    'prepayments.allocate',
    'prepayments.refund',
    'prepayments.reverse',
    'prepayments.reconcile',
    'prepayments.export',
    'prepayments.age',
    'prepayments.match',
    'prepayments.configure',
    'quotations.manage',
    'guests.manage',
    'guests.blacklist',
    'rooms.manage',
    'housekeeping.manage',
    'maintenance.manage',
    'expenses.manage',
    'staff.manage',
    'staff.permissions',
    'conference.manage',
    'pool.manage',
    'pos.manage',
    'pos.void',
    'pos.discount',
    'pos.price_override',
    'pos.menu_manage',
    'inventory.manage',
    'supplies.manage',
    'data.import',
    'settings.manage_general',
    'settings.manage_subscription',
    'sync.manage',
    'backup.manage',
    'online_booking.manage'
  ])

  const capabilities = { ...(snapshot.capabilities || {}) }
  blockedOnMobile.forEach((capability) => {
    if (capability in capabilities) capabilities[capability] = false
  })

  return {
    ...snapshot,
    capabilities,
    enabledCount: Object.values(capabilities).filter(Boolean).length
  }
}

/** @param {unknown} lodgeId @param {unknown} snapshot */
export function storeAccessSnapshot(lodgeId, snapshot) {
  writeLocalJson(scoped(ACCESS_PREFIX, lodgeId), snapshot)
}

function getSessionLodgeId() {
  return readField(getSession(), 'lodge_id')
}

/** @param {unknown} [lodgeId] @returns {unknown} */
function getStoredAccessSnapshot(lodgeId = getSessionLodgeId()) {
  return readLocalJson(scoped(ACCESS_PREFIX, lodgeId), null)
}

/** @param {unknown} lodgeId @param {unknown} entitlement */
export function storeEntitlement(lodgeId, entitlement) {
  writeLocalJson(scoped(ENTITLEMENT_PREFIX, lodgeId), {
    ...Object(entitlement),
    cached_at: new Date().toISOString()
  })
}

/** @param {unknown} [lodgeId] @returns {UnknownRecord | null} */
export function getStoredEntitlement(lodgeId = getSessionLodgeId()) {
  const entitlement = readLocalJson(scoped(ENTITLEMENT_PREFIX, lodgeId), null)
  if (!entitlement || typeof entitlement !== 'object') return null

  const offlineValidUntil = readField(entitlement, 'offline_valid_until')
    || readField(entitlement, 'offlineValidUntil')
  // A cache timestamp is not an entitlement lease.  Without a server-issued
  // lease, an offline client must fail closed rather than inventing access.
  if (!offlineValidUntil) return null

  const validUntil = Reflect.construct(Date, [offlineValidUntil])
  if (Number.isFinite(validUntil.getTime()) && validUntil >= new Date()) {
    return {
      ...entitlement,
      offline_valid_until: validUntil.toISOString(),
      source: readField(entitlement, 'source') || 'offline_lease',
      offline: true
    }
  }

  return {
    ...entitlement,
    expired: true,
    status: 'expired',
    subscription_state: 'offline_lease_expired',
    payment_status: readField(entitlement, 'payment_status') || 'offline_lease_expired',
    effective_features: Object.fromEntries(Object.keys(FEATURE_LABELS).map((featureName) => [featureName, false]))
  }
}

/** @param {string} capability @param {unknown} [lodgeId] @returns {boolean} */
function hasCapability(capability, lodgeId = getSessionLodgeId()) {
  const capabilities = readField(getStoredAccessSnapshot(lodgeId), 'capabilities')
  return readField(capabilities, capability) === true
}

/** @param {string} capability @param {{lodgeId?: unknown, message?: string}} [options] */
export function assertCapability(capability, options = {}) {
  if (hasCapability(capability, options.lodgeId)) return
  throw new Error(options.message || `${readField(CAPABILITY_LABELS, capability) || 'This action'} is not available for your account.`)
}

/** @param {unknown} role */
export function getRoleMeta(role) {
  return readField(ROLE_DEFINITIONS, normalizeAppRole(role)) || ROLE_DEFINITIONS.receptionist
}
