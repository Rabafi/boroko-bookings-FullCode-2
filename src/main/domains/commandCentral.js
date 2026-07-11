import { state } from '../state.js'
import { requireAdmin, dedupePromise } from './infrastructure.js'

async function callCommandCentralRpc(fn, args, useAdmin = false) {
  const db = useAdmin ? requireAdmin() : state.supabase
  const { data, error } = await db.rpc(fn, args)
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Command central operation failed')
  return data
}

async function _getEffectiveFeatureFlags(lodgeId) {
  const currentLodgeId = lodgeId || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  return callCommandCentralRpc('get_effective_feature_flags', { p_lodge_id: currentLodgeId })
}

export function getEffectiveFeatureFlags(lodgeId) {
  return dedupePromise(`cmdCentral:features:${lodgeId || state.lodgeId}`, () => _getEffectiveFeatureFlags(lodgeId))
}

async function _getActivationHistory(licenseId) {
  if (!licenseId) throw new Error('License ID is required')
  const data = await callCommandCentralRpc('get_activation_history', { p_license_id: licenseId }, true)
  return Array.isArray(data) ? data : []
}

export function getActivationHistory(licenseId) {
  return dedupePromise(`cmdCentral:history:${licenseId}`, () => _getActivationHistory(licenseId))
}

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

async function _getPendingUpgradeRequests(status = 'pending') {
  const data = await callCommandCentralRpc('get_pending_upgrade_requests', { p_status: status }, true)
  return Array.isArray(data) ? data : []
}

export function getPendingUpgradeRequests(status) {
  return dedupePromise(`cmdCentral:upgrades:${status || 'all'}`, () => _getPendingUpgradeRequests(status))
}
