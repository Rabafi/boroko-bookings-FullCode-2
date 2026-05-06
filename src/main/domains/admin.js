import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { state } from '../state.js'
import { createInvoice } from './finance.js'
import { removeLocalCompanyProfile } from './profiles.js'
import { normalizeLodgeId } from './shared.js'
import {
  DEFAULT_OFFLINE_LEASE_DAYS,
  DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  normalizePlanName
} from './subscriptionState.js'
import {
  requireAdmin,
  clearCache,
  refreshCache
} from './infrastructure.js'
import { buildUsageSummary, buildUsageWarning, getMonthWindowIso } from './usageSupport.js'
import { checkOnline } from './connectivity.js'
import { resolvePwaAccessUpdate } from './users.js'
import { isMissingEntitlementRpcError } from './subscriptions.js'
import {
  normalizeSubscriptionPlan,
  getPlanUsageLimits,
  getNextSubscriptionPlan,
  MONTHLY_USAGE_RESET_COPY
} from '../../shared/subscriptionPlans.js'

// ─── ADMIN: MASTER ADMIN ──────────────────────────────────────────────────────

export async function checkMasterAdmin(email, password) {
  await checkOnline();
  if (!state.isOnline) {
    console.log('[MASTER] Connectivity ping reported offline — still attempting master_admins lookup (if service key is set)');
  }
  if (!state.adminDb) {
    return null;
  }
  const { data, error } = await requireAdmin().
  from('master_admins').
  select('*').
  eq('email', email.toLowerCase().trim()).
  limit(1);
  if (error) console.error('[MASTER] DB error during admin lookup:', error.message);
  const admin = data?.[0];
  const passwordMatch = admin ? bcrypt.compareSync(password, admin.password_hash) : false;
  if (error) return null;
  if (!admin) return null;
  if (!passwordMatch) return null;
  return {
    id: admin.id,
    name: admin.name || 'Master Admin',
    email: admin.email,
    role: 'super_admin',
    isMasterAdmin: true
  };
}

export async function masterAdminExists() {
  if (!state.isOnline) return false;
  const { count } = await requireAdmin().from('master_admins').select('id', { count: 'exact', head: true });
  return (count || 0) > 0;
}

export async function createMasterAdmin(name, email, password) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { count } = await requireAdmin().from('master_admins').select('id', { count: 'exact', head: true });
  if ((count || 0) > 0) throw new Error('Master admin already exists');
  const password_hash = bcrypt.hashSync(password, 12);
  const { data, error } = await requireAdmin().from('master_admins').insert({
    email: email.toLowerCase().trim(),
    password_hash,
    name
  }).select().single();
  if (error) throw new Error(error.message);
  return { success: true, id: data.id };
}

// ─── ADMIN: All Companies ──────────────────────────────────────────────────────

export async function getAllCompanies() {
  if (!state.isOnline) return [];
  const { data } = await requireAdmin().
  from('settings').
  select('lodge_id, lodge_name, company_name, business_type, city, country, email, phone, updated_at, setup_complete, trial_started_at, deleted').
  eq('setup_complete', true).
  order('updated_at', { ascending: false });
  return data || [];
}

export async function updateCompany(lodgeId, updates) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().
  from('settings').
  update(updates).
  eq('lodge_id', lodgeId);
  if (error) throw error;
}

export async function archiveCompany(targetLodgeId) {
  if (!targetLodgeId) throw new Error('Company lodge_id is required');
  await updateCompany(targetLodgeId, { deleted: true, updated_at: new Date().toISOString() });
  await logAdminActivity(targetLodgeId, null, 'company_archived', {
    actor_id: state.currentUser?.id || null,
    actor_role: state.currentUser?.role || null
  });
  return { success: true };
}

export async function restoreCompany(targetLodgeId) {
  if (!targetLodgeId) throw new Error('Company lodge_id is required');
  await updateCompany(targetLodgeId, { deleted: false, updated_at: new Date().toISOString() });
  await logAdminActivity(targetLodgeId, null, 'company_restored', {
    actor_id: state.currentUser?.id || null,
    actor_role: state.currentUser?.role || null
  });
  return { success: true };
}

const COMPANY_PURGE_TABLES = [
'pos_order_items',
'inventory_stocktake_lines',
'supply_stocktake_lines',
'room_supply_stocktake_lines',
'booking_charges',
'payments',
'invoices',
'room_supply_allocations',
'room_supply_room_stock',
'room_supply_movements',
'inventory_purchases',
'supply_purchases',
'pos_override_log',
'pos_orders',
'conference_bookings',
'pool_day_use',
'maintenance_tickets',
'room_rate_overrides',
'expenses',
'quotations',
'bookings',
'inventory_stocktakes',
'supply_stocktakes',
'room_supply_stocktakes',
'pos_menu_items',
'inventory_items',
'supply_items',
'outlets',
'rooms',
'customers',
'users',
'lodge_features',
'licenses',
'support_tickets',
'broadcasts',
'activity_logs'];

function shouldIgnorePurgeDeleteError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01' ||
  code === '42703' ||
  /relation .* does not exist/i.test(message) ||
  /column .* does not exist/i.test(message);
}

async function deleteLodgeScopedRows(adminClient, tableName, targetLodgeId) {
  const { count, error } = await adminClient.
  from(tableName).
  delete({ count: 'exact' }).
  eq('lodge_id', targetLodgeId);

  if (error) {
    if (shouldIgnorePurgeDeleteError(error)) return { table: tableName, deleted: 0, skipped: true };
    throw new Error(`Could not delete ${tableName}: ${error.message}`);
  }
  return { table: tableName, deleted: count || 0, skipped: false };
}

export async function permanentlyDeleteCompany(targetLodgeId) {
  const normalizedId = normalizeLodgeId(targetLodgeId);
  if (!normalizedId) throw new Error('Company lodge_id is required');
  await checkOnline();
  if (!state.isOnline) throw new Error('Requires internet connection');

  const adminClient = requireAdmin();
  const { data: company, error: lookupError } = await adminClient.
  from('settings').
  select('lodge_id, lodge_name, company_name').
  eq('lodge_id', normalizedId).
  maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  const deleted = [];
  for (const tableName of COMPANY_PURGE_TABLES) {
    deleted.push(await deleteLodgeScopedRows(adminClient, tableName, normalizedId));
  }

  const { count: settingsDeleted, error: settingsError } = await adminClient.
  from('settings').
  delete({ count: 'exact' }).
  eq('lodge_id', normalizedId);
  if (settingsError) throw new Error(`Could not delete settings: ${settingsError.message}`);
  deleted.push({ table: 'settings', deleted: settingsDeleted || 0, skipped: false });

  const local = removeLocalCompanyProfile(normalizedId);

  return {
    success: true,
    company: company || null,
    deleted,
    local,
    deleted_count: deleted.reduce((sum, entry) => sum + Number(entry.deleted || 0), 0)
  };
}

export async function repairDuplicateEventBookings(targetLodgeId = null) {
  await checkOnline();
  if (!state.isOnline) throw new Error('Requires internet connection');
  const normalizedId = targetLodgeId ? normalizeLodgeId(targetLodgeId) : null;
  const { data, error } = await requireAdmin().rpc('repair_duplicate_event_bookings', {
    p_lodge_id: normalizedId || null
  });
  if (error) throw new Error(error.message);
  return {
    success: true,
    repaired: Array.isArray(data) ? data : []
  };
}

export async function getCompanyUsers(lodgeId) {
  if (!state.isOnline) return [];
  const { data } = await requireAdmin().
  from('users').
  select('id, name, email, role, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by').
  eq('lodge_id', lodgeId).
  order('name');
  return data || [];
}

export async function resetCompanyUserPassword(targetLodgeId, userId, password) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

  const password_hash = bcrypt.hashSync(password, 10);
  const { data: result, error } = await requireAdmin().rpc('set_user_password', {
    p_id: userId,
    p_lodge_id: targetLodgeId,
    p_password_hash: password_hash
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not reset password');

  const user = (await getCompanyUsers(targetLodgeId)).find((entry) => entry.id === userId);
  await logAdminActivity(targetLodgeId, null, 'company_user_password_reset', {
    actor_id: state.currentUser?.id || null,
    actor_role: state.currentUser?.role || null,
    user_id: userId,
    user_email: user?.email || null,
    user_role: user?.role || null
  });
  return { success: true };
}

export async function updateCompanyUserPwaAccess(targetLodgeId, userId, payload = {}) {
  if (!state.isOnline) throw new Error('Requires internet connection');

  const user = (await getCompanyUsers(targetLodgeId)).find((entry) => entry.id === userId);
  if (!user) throw new Error('Staff account not found.');

  const pwaAccess = resolvePwaAccessUpdate(user, payload);
  if (!pwaAccess.requested) {
    return { success: true };
  }

  const { data: result, error } = await requireAdmin().rpc('set_user_pwa_access', {
    p_id: userId,
    p_lodge_id: targetLodgeId,
    p_enabled: pwaAccess.enabled,
    p_password_hash: pwaAccess.password_hash,
    p_disabled_reason: pwaAccess.disabled_reason,
    p_reset_by: state.currentUser?.id || null
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not update manager mobile app access');

  await logAdminActivity(targetLodgeId, null, 'company_user_pwa_access_updated', {
    actor_id: state.currentUser?.id || null,
    actor_role: state.currentUser?.role || null,
    user_id: userId,
    user_email: user.email || null,
    user_role: user.role || null,
    pwa_enabled: pwaAccess.enabled,
    pwa_disabled_reason: pwaAccess.disabled_reason,
    password_reset: Boolean(pwaAccess.password_hash)
  });
  return { success: true };
}

// ─── ADMIN: ACTIVITY LOGS ──────────────────────────────────────────────────────

export async function logAdminActivity(targetLodgeId, targetLodgeName, action, details = {}) {
  if (!state.isOnline || !state.adminDb) return; // fire-and-forget, silent; skip if no admin client
  state.adminDb.from('activity_logs').insert({
    lodge_id: targetLodgeId,
    lodge_name: targetLodgeName || null,
    action,
    details
  }).then(() => {}).catch(() => {});
}

export async function getActivityLogs(filters = {}) {
  if (!state.isOnline) return [];
  let q = requireAdmin().from('activity_logs').select('*');
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id);
  if (filters.start) q = q.gte('created_at', filters.start);
  if (filters.end) q = q.lte('created_at', filters.end);
  const limit = filters.limit || 200;
  const { data } = await q.order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

// ─── ADMIN: COMPANY STATS ──────────────────────────────────────────────────────

export async function getCompanyStats(targetLodgeId) {
  if (!state.isOnline) return null;
  const db = requireAdmin();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const currentMonthWindow = getMonthWindowIso();
  const entitlement = await (await import('./' + 'subscriptions.js')).getTrialStatus(targetLodgeId).catch(() => null);
  const plan = normalizeSubscriptionPlan(entitlement?.plan || 'Starter');
  const limits = getPlanUsageLimits(plan);
  const [rooms, users, bookings, monthlyConfirmedBookings, monthlyCreatedBookings, latestCreatedBooking, latestCheckInBooking, expenses, maintenance] = await Promise.all([
  db.from('rooms').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId),
  db.from('users').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId),
  db.from('bookings').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId).gte('created_at', thirtyDaysAgo),
  db.from('bookings').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId).
  in('status', ['confirmed', 'checked_in', 'checked_out']).
  neq('is_exclusive_event', true).
  gte('check_in', currentMonthWindow.dateStart).
  lt('check_in', currentMonthWindow.dateEnd),
  db.from('bookings').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId).
  in('status', ['confirmed', 'checked_in', 'checked_out']).
  neq('is_exclusive_event', true).
  gte('created_at', currentMonthWindow.start.toISOString()).
  lt('created_at', currentMonthWindow.end.toISOString()),
  db.from('bookings').
  select('created_at, check_in').
  eq('lodge_id', targetLodgeId).
  order('created_at', { ascending: false }).
  limit(1),
  db.from('bookings').
  select('created_at, check_in').
  eq('lodge_id', targetLodgeId).
  order('check_in', { ascending: false }).
  limit(1),
  db.from('expenses').select('amount').eq('lodge_id', targetLodgeId).gte('date', thirtyDaysAgo),
  db.from('maintenance_tickets').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId).eq('status', 'open')]
  );
  const expenseTotal = (expenses.data || []).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const latestBookingCreatedAt = latestCreatedBooking?.data?.[0]?.created_at || null;
  const latestBookingCheckIn = latestCheckInBooking?.data?.[0]?.check_in || null;
  const lastBookingDate = [latestBookingCreatedAt, latestBookingCheckIn].filter(Boolean).sort().reverse()[0] || null;
  const usage = {
    monthlyBookings: Number(monthlyConfirmedBookings.count || 0),
    targetMonthBookings: Number(monthlyConfirmedBookings.count || 0),
    creationMonthBookings: Number(monthlyCreatedBookings.count || 0),
    rooms: Number(rooms.count || 0),
    users: Number(users.count || 0)
  };
  const usageSummary = buildUsageSummary(plan, limits, usage, 'remote');
  return {
    rooms: rooms.count || 0,
    users: users.count || 0,
    bookings_30d: bookings.count || 0,
    monthly_confirmed_bookings: monthlyConfirmedBookings.count || 0,
    monthly_created_bookings: monthlyCreatedBookings.count || 0,
    plan,
    usage,
    usage_limits: limits,
    usage_status: {
      bookings: usageSummary.statuses.bookings,
      booking_target_month: usageSummary.statuses.bookingTargetMonth,
      booking_creation_month: usageSummary.statuses.bookingCreationMonth,
      rooms: usageSummary.statuses.rooms,
      users: usageSummary.statuses.users
    },
    warning: buildUsageWarning(usageSummary),
    recommendation: usageSummary.recommendation,
    next_recommended_plan: usageSummary.recommendation?.recommendedPlan || getNextSubscriptionPlan(plan),
    monthly_reset_copy: MONTHLY_USAGE_RESET_COPY,
    expenses_30d: expenseTotal,
    open_maintenance: maintenance.count || 0,
    last_booking_date: lastBookingDate
  };
}

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
