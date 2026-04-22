import {
  CAPABILITY_LABELS,
  FEATURE_LABELS,
  ROLE_DEFINITIONS,
  buildCapabilitySnapshot,
  normalizeAppRole
} from '@shared/accessControl'
import { getSession, readLocalJson, writeLocalJson } from './runtime'

const ACCESS_PREFIX = 'boroko_pwa_access'
const ENTITLEMENT_PREFIX = 'boroko_pwa_entitlement'

function scoped(prefix, lodgeId) {
  return `${prefix}:${String(lodgeId || 'global').trim().toLowerCase()}`
}

export function normalizeSessionUser(row = {}) {
  return {
    id: row.id || row.user_id || row.manager_id || '',
    name: row.name || row.user_name || 'Boroko User',
    email: String(row.email || '').trim().toLowerCase(),
    role: normalizeAppRole(row.role || 'manager'),
    lodge_id: String(row.lodge_id || '').trim().toLowerCase(),
    lodge_display_name: row.lodge_display_name || row.lodge_name || row.company_name || 'Your Lodge'
  }
}

export function buildAccessSnapshot(user, features = {}) {
  const snapshot = buildCapabilitySnapshot({
    role: normalizeAppRole(user?.role),
    features
  })

  const blockedOnMobile = new Set([
    'bookings.manage',
    'payments.record',
    'payments.refund',
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

export function storeAccessSnapshot(lodgeId, snapshot) {
  writeLocalJson(scoped(ACCESS_PREFIX, lodgeId), snapshot)
}

function getStoredAccessSnapshot(lodgeId = getSession()?.lodge_id) {
  return readLocalJson(scoped(ACCESS_PREFIX, lodgeId), null)
}

export function storeEntitlement(lodgeId, entitlement) {
  writeLocalJson(scoped(ENTITLEMENT_PREFIX, lodgeId), {
    ...entitlement,
    cached_at: new Date().toISOString()
  })
}

export function getStoredEntitlement(lodgeId = getSession()?.lodge_id) {
  const entitlement = readLocalJson(scoped(ENTITLEMENT_PREFIX, lodgeId), null)
  if (!entitlement || typeof entitlement !== 'object') return null

  const offlineValidUntil = entitlement.offline_valid_until
    || entitlement.offlineValidUntil
    || (entitlement.cached_at
      ? new Date(new Date(entitlement.cached_at).getTime() + (7 * 24 * 60 * 60 * 1000)).toISOString()
      : null)
  if (!offlineValidUntil) return entitlement

  const validUntil = new Date(offlineValidUntil)
  if (!Number.isFinite(validUntil.getTime()) || validUntil >= new Date()) return entitlement

  return {
    ...entitlement,
    expired: true,
    status: 'expired',
    subscription_state: 'offline_lease_expired',
    payment_status: entitlement.payment_status || 'offline_lease_expired',
    effective_features: Object.fromEntries(Object.keys(FEATURE_LABELS).map((featureName) => [featureName, false]))
  }
}

function hasCapability(capability, lodgeId = getSession()?.lodge_id) {
  return getStoredAccessSnapshot(lodgeId)?.capabilities?.[capability] === true
}

export function assertCapability(capability, options = {}) {
  if (hasCapability(capability, options.lodgeId)) return
  throw new Error(options.message || `${CAPABILITY_LABELS[capability] || 'This action'} is not available for your account.`)
}

export function getRoleMeta(role) {
  return ROLE_DEFINITIONS[normalizeAppRole(role)] || ROLE_DEFINITIONS.receptionist
}
