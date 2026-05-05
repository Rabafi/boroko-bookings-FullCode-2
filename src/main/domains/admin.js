import { state } from '../state.js'
import {
  isMissingEntitlementRpcError,
  logAdminActivity,
  requireAdmin
} from './infrastructure.js'

export {
  checkMasterAdmin,
  masterAdminExists,
  createMasterAdmin,
  getAllCompanies,
  updateCompany,
  archiveCompany,
  restoreCompany,
  permanentlyDeleteCompany,
  repairDuplicateEventBookings,
  getCompanyUsers,
  resetCompanyUserPassword,
  updateCompanyUserPwaAccess,
  getLicenses,
  createLicense,
  issueSubscriptionContract,
  updateLicense,
  deleteLicense,
  getTestDataResetPreview,
  runTestDataReset,
  getTestDataResetAudit,
  getSupportTickets,
  createSupportTicket,
  getLodgeSupportTickets,
  getLodgeSupportTicketById,
  updateLodgeSupportTicket,
  updateSupportTicket,
  deleteSupportTicket,
  getActivityLogs,
  getCompanyStats,
  updateLicenseBilling,
  getOverdueLicenses
} from './infrastructure.js'

// ─── ADMIN: BROADCASTS ────────────────────────────────────────────────────────

export async function getBroadcasts() {
  if (!state.isOnline) return [];
  const { data } = await requireAdmin().from('broadcasts').select('*').order('created_at', { ascending: false });
  return data || [];
}

export async function getActiveBroadcasts() {
  if (!state.isOnline) return [];
  const now = new Date().toISOString();
  const { data } = await state.supabase.
  from('broadcasts').
  select('*').
  eq('is_active', true).
  or(`expires_at.is.null,expires_at.gt.${now}`).
  order('created_at', { ascending: false });
  return data || [];
}

export async function createBroadcast({ title, message, expires_at }) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data: result, error } = await requireAdmin().rpc('create_broadcast', {
    payload: {
      title,
      message,
      expires_at: expires_at || null,
      is_active: true
    }
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not create broadcast');
  return result;
}

export async function updateBroadcast(id, updates) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data: result, error } = await requireAdmin().rpc('update_broadcast', {
    p_id: id,
    payload: updates || {}
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not update broadcast');
  return { success: true };
}

export async function deleteBroadcast(id) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data: result, error } = await requireAdmin().rpc('delete_broadcast', {
    p_id: id
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not delete broadcast');
  return { success: true };
}

// ─── ADMIN: FEATURE FLAGS ──────────────────────────────────────────────────────

export async function getLodgeFeatures(targetLodgeId) {
  if (!state.isOnline) return [];
  const { data, error } = await requireAdmin().
  from('lodge_features').
  select('feature_name, enabled, reason, expires_at, review_at, granted_at, granted_by, updated_at').
  eq('lodge_id', targetLodgeId);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function setLodgeFeature(targetLodgeId, featureName, enabled, metadata = {}) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  try {
    const { data, error } = await requireAdmin().rpc('set_subscription_feature_override', {
      p_lodge_id: targetLodgeId,
      p_feature_name: featureName,
      p_enabled: enabled !== false,
      p_reason: metadata?.reason || null,
      p_expires_at: metadata?.expires_at || null,
      p_review_at: metadata?.review_at || null,
      p_granted_by: state.currentUser?.id || null
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data.error || 'Could not save feature override');
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message);
    const { error: fallbackError } = await requireAdmin().
    from('lodge_features').
    upsert(
      {
        lodge_id: targetLodgeId,
        feature_name: featureName,
        enabled,
        updated_at: new Date().toISOString(),
        reason: metadata?.reason || null,
        expires_at: metadata?.expires_at || null,
        review_at: metadata?.review_at || null,
        granted_by: state.currentUser?.id || null,
        granted_at: new Date().toISOString()
      },
      { onConflict: 'lodge_id,feature_name' }
    );
    if (fallbackError) throw new Error(fallbackError.message);
  }
  await logAdminActivity(targetLodgeId, null, 'feature_override_set', {
    actor_id: state.currentUser?.id || null,
    actor_role: state.currentUser?.role || null,
    feature_name: featureName,
    enabled: enabled !== false,
    reason: metadata?.reason || null,
    expires_at: metadata?.expires_at || null,
    review_at: metadata?.review_at || null
  });
  return { success: true };
}

export async function clearLodgeFeature(targetLodgeId, featureName) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  try {
    const { data, error } = await requireAdmin().rpc('clear_subscription_feature_override', {
      p_lodge_id: targetLodgeId,
      p_feature_name: featureName
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data.error || 'Could not clear feature override');
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message);
    const { error: fallbackError } = await requireAdmin().
    from('lodge_features').
    delete().
    eq('lodge_id', targetLodgeId).
    eq('feature_name', featureName);
    if (fallbackError) throw new Error(fallbackError.message);
  }
  await logAdminActivity(targetLodgeId, null, 'feature_override_cleared', {
    actor_id: state.currentUser?.id || null,
    actor_role: state.currentUser?.role || null,
    feature_name: featureName
  });
  return { success: true };
}

export async function getAllLodgeFeatures() {
  if (!state.isOnline) return [];
  const { data } = await requireAdmin().from('lodge_features').select('*').order('lodge_id');
  return data || [];
}
