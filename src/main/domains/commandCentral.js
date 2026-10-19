// @ts-check
import { state } from '../state.js'
import { requireAdmin, dedupePromise } from './infrastructure.js'

/** @param {string} fn @param {Record<string, unknown>} args @param {boolean} [useAdmin] @returns {Promise<unknown>} */
async function callCommandCentralRpc(fn, args, useAdmin = false) {
  const db = useAdmin ? requireAdmin() : state.supabase
  const { data, error } = await db.rpc(fn, args)
  if (error) throw error
  // The Supabase SDK exposes RPC `data` as upstream `any`; preserve the
  // existing envelope property reads without asserting that remote JSON is validated.
  if (data?.success === false) throw new Error(data.error || 'Command central operation failed')
  return data
}

/** @param {unknown} lodgeId @returns {Promise<unknown>} */
async function _getEffectiveFeatureFlags(lodgeId) {
  const currentLodgeId = lodgeId || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  return callCommandCentralRpc('get_effective_feature_flags', { p_lodge_id: currentLodgeId })
}

/** @param {unknown} lodgeId @returns {Promise<unknown>} */
export function getEffectiveFeatureFlags(lodgeId) {
  return dedupePromise(`cmdCentral:features:${lodgeId || state.lodgeId}`, () => _getEffectiveFeatureFlags(lodgeId))
}

/** @param {unknown} licenseId @returns {Promise<unknown[]>} */
async function _getActivationHistory(licenseId) {
  if (!licenseId) throw new Error('License ID is required')
  const data = await callCommandCentralRpc('get_activation_history', { p_license_id: licenseId }, true)
  return Array.isArray(data) ? /** @type {unknown[]} */ (data) : []
}

/** @param {unknown} licenseId @returns {Promise<unknown[]>} */
export function getActivationHistory(licenseId) {
  return dedupePromise(`cmdCentral:history:${licenseId}`, () => _getActivationHistory(licenseId))
}

/** @param {unknown} lodgeId @param {unknown} addonKey @param {unknown} [deactivatedBy] @param {unknown} [reason] @returns {Promise<unknown>} */
export async function deactivateEnterpriseAddon(lodgeId, addonKey, deactivatedBy = 'admin', reason = null) {
  const currentLodgeId = lodgeId || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  return callCommandCentralRpc('deactivate_enterprise_addon', {
    p_lodge_id: currentLodgeId,
    p_addon_key: addonKey,
    p_deactivated_by: deactivatedBy,
    p_reason: reason
  }, true)
}

/** @param {unknown} [status] @returns {Promise<unknown[]>} */
async function _getPendingUpgradeRequests(status = 'pending') {
  const data = await callCommandCentralRpc('get_pending_upgrade_requests', { p_status: status }, true)
  return Array.isArray(data) ? /** @type {unknown[]} */ (data) : []
}

/** @param {unknown} status @returns {Promise<unknown[]>} */
export function getPendingUpgradeRequests(status) {
  return dedupePromise(`cmdCentral:upgrades:${status || 'all'}`, () => _getPendingUpgradeRequests(status))
}
