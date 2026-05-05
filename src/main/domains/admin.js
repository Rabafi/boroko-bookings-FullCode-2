import crypto from 'crypto'
import { state } from '../state.js'
import { createInvoice } from './finance.js'
import {
  DEFAULT_OFFLINE_LEASE_DAYS,
  DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  isMissingEntitlementRpcError,
  logAdminActivity,
  normalizePlanName,
  requireAdmin,
  clearCache,
  refreshCache
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
  getActivityLogs,
  getCompanyStats
} from './infrastructure.js'

// ─── ADMIN: Licenses ───────────────────────────────────────────────────────────

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const seg = (offset) => Array.from(bytes.slice(offset, offset + 4), (value) => chars[value % chars.length]).join('');
  return `BB-${seg(0)}-${seg(4)}-${seg(8)}`;
}

export async function getLicenses() {
  if (!state.isOnline) return [];
  const { data } = await requireAdmin().
  from('licenses').
  select('*').
  order('issued_at', { ascending: false });
  return (data || []).map((license) => ({
    ...license,
    subscription_plan: normalizePlanName(license.subscription_plan)
  }));
}

export async function createLicense({ lodge_id, lodge_name, business_type, expires_at, notes, subscription_plan, payment_status, monthly_fee, currency, next_due_date, last_payment_date }) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const normalizedPlan = normalizePlanName(subscription_plan);

  try {
    const { data, error } = await requireAdmin().rpc('issue_subscription_contract', {
      p_payload: {
        lodge_id: lodge_id || null,
        lodge_name: lodge_name || '',
        business_type: business_type || 'lodge',
        expires_at: expires_at || null,
        notes: notes || null,
        subscription_plan: normalizedPlan,
        payment_status: payment_status || 'active',
        monthly_fee: Number(monthly_fee || 0),
        currency: currency || 'BWP',
        next_due_date: next_due_date || null,
        last_payment_date: last_payment_date || null,
        create_invoice: false
      }
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data.error || 'Could not create subscription');
    if (data?.license) return data.license;
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const license_key = generateLicenseKey();
    const { data, error } = await requireAdmin().from('licenses').insert({
      lodge_id: lodge_id || 'unassigned',
      license_key,
      lodge_name: lodge_name || '',
      business_type: business_type || 'lodge',
      expires_at: expires_at || null,
      notes: notes || null,
      subscription_plan: normalizedPlan,
      payment_status: payment_status || 'active',
      monthly_fee: Number(monthly_fee || 0),
      currency: currency || 'BWP',
      next_due_date: next_due_date || null,
      last_payment_date: last_payment_date || null,
      is_active: true
    }).select().single();
    if (!error) return data;
    if (String(error.message || '').toLowerCase().includes('license_key')) continue;
    throw new Error(error.message);
  }

  throw new Error('Could not generate a unique license key. Please try again.');
}

export async function issueSubscriptionContract({ license = {}, invoice = null } = {}) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const normalizedPlan = normalizePlanName(license.subscription_plan);
  const payload = {
    lodge_id: license.lodge_id || null,
    lodge_name: license.lodge_name || '',
    business_type: license.business_type || 'lodge',
    expires_at: license.expires_at || null,
    notes: license.notes || null,
    subscription_plan: normalizedPlan,
    payment_status: license.payment_status || 'active',
    monthly_fee: Number(license.monthly_fee || 0),
    currency: license.currency || 'BWP',
    next_due_date: license.next_due_date || null,
    last_payment_date: license.last_payment_date || null,
    grace_period_days: license.grace_period_days || DEFAULT_SUBSCRIPTION_GRACE_DAYS,
    offline_lease_days: license.offline_lease_days || DEFAULT_OFFLINE_LEASE_DAYS,
    create_invoice: !!invoice,
    invoice: invoice ?
    {
      ...invoice,
      package_name: normalizedPlan
    } :
    null
  };

  try {
    const { data, error } = await requireAdmin().rpc('issue_subscription_contract', {
      p_payload: payload
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data.error || 'Could not create subscription');
    return data;
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message);
  }

  const createdLicense = await createLicense({
    ...license,
    subscription_plan: normalizedPlan
  });
  let createdInvoice = null;
  if (invoice) {
    createdInvoice = await createInvoice({
      ...invoice,
      license_id: createdLicense?.id || null,
      package_name: normalizedPlan
    });
  }
  return {
    success: true,
    license: createdLicense,
    invoice: createdInvoice
  };
}

export async function updateLicense(id, updates) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('licenses').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteLicense(id) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('licenses').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ─── ADMIN: BILLING ────────────────────────────────────────────────────────────

export async function updateLicenseBilling(id, data) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const update = { ...data };
  if (Object.prototype.hasOwnProperty.call(update, 'subscription_plan')) {
    update.subscription_plan = normalizePlanName(update.subscription_plan);
  }
  try {
    const { data: result, error } = await requireAdmin().rpc('update_subscription_contract', {
      p_license_id: id,
      p_payload: update
    });
    if (error) throw error;
    if (result?.success === false) throw new Error(result.error || 'Could not update subscription');
    return { success: true };
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message);
  }
  const { error } = await requireAdmin().from('licenses').update(update).eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function getOverdueLicenses() {
  if (!state.isOnline) return [];
  const today = new Date().toISOString().split('T')[0];
  const { data } = await requireAdmin().
  from('licenses').
  select('*').
  lt('next_due_date', today).
  neq('payment_status', 'free').
  eq('is_active', true);
  return data || [];
}

// ─── ADMIN: SUPPORT TICKETS ────────────────────────────────────────────────────

export async function getSupportTickets(filters = {}) {
  if (!state.isOnline) return [];
  let q = requireAdmin().from('support_tickets').select('*');
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.priority) q = q.eq('priority', filters.priority);
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id);
  const { data } = await q.order('created_at', { ascending: false });
  return data || [];
}

export async function createSupportTicket({ lodge_id, lodge_name, title, description, category, priority }) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  // Use the admin client when available (Command Central machine) to bypass RLS.
  // On lodge machines (no service key), fall back to the anon client — the anon
  // client can INSERT but cannot SELECT from support_tickets, so we skip .select()
  // to avoid a false RLS failure on the read-back that would mask a successful insert.
  const { error } = await (state.adminDb || state.supabase).
  from('support_tickets').
  insert({
    lodge_id: lodge_id || state.lodgeId,
    lodge_name: lodge_name || null,
    title,
    description,
    category: category || 'General',
    priority: priority || 'Normal',
    status: 'open'
  });
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function getLodgeSupportTickets(limit = 20) {
  if (!state.isOnline) return [];
  const { data, error } = await state.supabase.rpc('get_lodge_support_tickets', {
    p_lodge_id: state.lodgeId,
    p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100)
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function getLodgeSupportTicketById(id) {
  if (!id || !state.isOnline) return null;
  const tickets = await getLodgeSupportTickets(100);
  return tickets.find((ticket) => ticket.id === id) || null;
}

export async function updateLodgeSupportTicket(id, updates = {}) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data, error } = await state.supabase.rpc('update_lodge_support_ticket', {
    p_ticket_id: id,
    p_lodge_id: state.lodgeId,
    p_status: updates.status || null,
    p_admin_notes: Object.prototype.hasOwnProperty.call(updates, 'admin_notes') ?
    updates.admin_notes :
    null
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not update request');
  return { success: true };
}

export async function updateSupportTicket(id, updates) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const payload = { ...updates, updated_at: new Date().toISOString() };
  if (updates.status === 'resolved' && !updates.resolved_at) {
    payload.resolved_at = new Date().toISOString();
  }
  const { error } = await requireAdmin().from('support_tickets').update(payload).eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteSupportTicket(id) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('support_tickets').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

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
  const { data } = await requireAdmin().  from('lodge_features').
  select('*').
  order('lodge_id');
  return data || [];
}

// ─── ADMIN: TEST RESET ────────────────────────────────────────────────────────

export async function getTestDataResetPreview(targetLodgeId, payload = {}) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data, error } = await requireAdmin().rpc('get_test_data_reset_preview', {
    p_lodge_id: targetLodgeId,
    p_mode: payload?.mode || 'full_demo_reset',
    p_days: Number(payload?.days || 30)
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not preview test reset');
  return data;
}

export async function runTestDataReset(targetLodgeId, payload = {}) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data, error } = await requireAdmin().rpc('reset_test_data', {
    p_lodge_id: targetLodgeId,
    p_mode: payload?.mode || 'full_demo_reset',
    p_days: Number(payload?.days || 30),
    p_confirmation: payload?.confirmation || '',
    p_reason: payload?.reason || '',
    p_triggered_by: state.currentUser?.id || null
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not reset test data');
  await logAdminActivity(targetLodgeId, payload?.lodge_name || null, 'test_data_reset', {
    mode: payload?.mode || 'full_demo_reset',
    days: Number(payload?.days || 30),
    reason: payload?.reason || '',
    deleted_counts: data?.deleted_counts || {}
  });
  if (targetLodgeId && targetLodgeId === state.lodgeId) {
    clearCache('bookings');
    clearCache('customers');
    clearCache('quotations');
    clearCache('expenses');
    clearCache('posOrders');
    clearCache('maintenance');
    try {
      await Promise.allSettled([
      refreshCache('bookings'),
      refreshCache('customers'),
      refreshCache('quotations'),
      refreshCache('expenses'),
      refreshCache('posOrders'),
      refreshCache('maintenance')]
      );
    } catch (_) {

      // Non-fatal: the reset already completed remotely, and stale cache will self-heal on next refresh.
    }}
  return data;
}

export async function getTestDataResetAudit(targetLodgeId, limit = 20) {
  if (!state.isOnline) return [];
  const { data, error } = await requireAdmin().rpc('get_test_data_reset_audit', {
    p_lodge_id: targetLodgeId,
    p_limit: Number(limit || 20)
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}
