import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { state } from '../state.js'
import { createInvoice } from './finance.js'
import { removeLocalCompanyProfile } from './profiles.js'
import { normalizeLodgeId } from './shared.js'
import {
  DEFAULT_OFFLINE_LEASE_DAYS,
  DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  computeSubscriptionState,
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
import { ensureSupabaseAuthStaffUserReady } from './authUsers.js'
import { isMissingEntitlementRpcError } from './subscriptions.js'
import {
  normalizeSubscriptionPlan,
  getPlanUsageLimits,
  getNextSubscriptionPlan,
  MONTHLY_USAGE_RESET_COPY
} from '../../shared/subscriptionPlans.js'
import { normalizeSupportTickets } from '../../shared/supportThreads.js'

// ─── ADMIN: MASTER ADMIN ──────────────────────────────────────────────────────

export async function checkMasterAdmin(email, password) {
  await checkOnline();
  if (!state.isOnline) {
    console.log('[MASTER] Connectivity ping reported offline — still attempting master_admins lookup (if service key is set)');
  }
  if (!state.adminDb) {
    return null;
  }
  let data, error;
  try {
    const queryPromise = requireAdmin().
      from('master_admins').
      select('*').
      eq('email', email.toLowerCase().trim()).
      limit(1);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('master admin query timed out')), 5000)
    );
    const result = await Promise.race([queryPromise, timeoutPromise]);
    data = result.data;
    error = result.error;
  } catch (e) {
    console.warn('[MASTER] Admin lookup timed out:', e.message);
    return null;
  }
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

const COMPANY_SETTINGS_SELECT = 'lodge_id, lodge_name, company_name, business_type, city, country, email, phone, updated_at, setup_complete, trial_started_at, deleted';
const COMPANY_SETTINGS_LEGACY_SELECT = 'lodge_id, lodge_name, company_name, business_type, updated_at, trial_started_at';
const COMPANY_SETTINGS_MINIMAL_SELECT = 'lodge_id, lodge_name, company_name';

function isSettingsColumnError(error) {
  const message = String(error?.message || error?.details || '').toLowerCase();
  return (message.includes('column') || message.includes('schema cache')) && message.includes('settings') && (
    message.includes('lodge_name') ||
    message.includes('company_name') ||
    message.includes('city') ||
    message.includes('country') ||
    message.includes('email') ||
    message.includes('phone') ||
    message.includes('business_type') ||
    message.includes('updated_at') ||
    message.includes('setup_complete') ||
    message.includes('trial_started_at') ||
    message.includes('deleted')
  );
}

function normalizeCompanySettingsRow(row = {}) {
  return {
    lodge_id: normalizeLodgeId(row.lodge_id),
    lodge_name: row.lodge_name || row.company_name || 'Unnamed company',
    company_name: row.company_name || row.lodge_name || 'Unnamed company',
    business_type: row.business_type || 'lodge',
    city: row.city || '',
    country: row.country || '',
    email: row.email || '',
    phone: row.phone || '',
    updated_at: row.updated_at || row.trial_started_at || null,
    setup_complete: row.setup_complete !== false,
    trial_started_at: row.trial_started_at || null,
    deleted: row.deleted === true
  };
}

function sortCompaniesByUpdatedAt(companies = []) {
  return [...companies].sort((a, b) => {
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    return bTime - aTime;
  });
}

async function queryCompanySettings(db, selectClause, orderByUpdatedAt = true) {
  let query = db.from('settings').select(selectClause).limit(1000);
  if (orderByUpdatedAt) {
    query = query.order('updated_at', { ascending: false });
  }
  return query;
}

async function loadCompanySettingsRows(db) {
  const attempts = [
    () => queryCompanySettings(db, COMPANY_SETTINGS_SELECT),
    () => queryCompanySettings(db, COMPANY_SETTINGS_LEGACY_SELECT),
    () => queryCompanySettings(db, COMPANY_SETTINGS_MINIMAL_SELECT, false),
    () => db.from('settings').select('*').limit(1000)
  ];
  let lastError = null;
  for (const attempt of attempts) {
    const { data, error } = await attempt();
    if (!error) return data || [];
    lastError = error;
    if (!isSettingsColumnError(error)) break;
  }
  throw new Error(lastError?.message || 'Could not load Command Central companies.');
}

export async function getAllCompanies() {
  if (!state.isOnline) return [];
  const db = requireAdmin();
  const data = await loadCompanySettingsRows(db);
  return sortCompaniesByUpdatedAt((data || [])
    .map(normalizeCompanySettingsRow)
    .filter((company) => company.lodge_id));
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
    entity_type: 'company',
    entity_id: targetLodgeId
  });
  return { success: true };
}

export async function restoreCompany(targetLodgeId) {
  if (!targetLodgeId) throw new Error('Company lodge_id is required');
  await updateCompany(targetLodgeId, { deleted: false, updated_at: new Date().toISOString() });
  await logAdminActivity(targetLodgeId, null, 'company_restored', {
    entity_type: 'company',
    entity_id: targetLodgeId
  });
  return { success: true };
}

const COMPANY_PURGE_TABLES = [
'pos_order_items',
'inventory_stocktake_lines',
'supply_stocktake_lines',
'room_supply_stocktake_lines',
'refund_approval_log',
'invoice_delivery_log',
'financial_validation_runs',
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
  select('id, auth_user_id, name, email, role, status, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by').
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
  if (user) {
    await ensureSupabaseAuthStaffUserReady(user, password, {
      adminClient: requireAdmin(),
      lodgeId: targetLodgeId
    });
  }
  await logAdminActivity(targetLodgeId, null, 'company_user_password_reset', {
    entity_type: 'user',
    entity_id: userId,
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
    entity_type: 'user',
    entity_id: userId,
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
  if (!state.isOnline || !state.adminDb) return;
  const actor = state.currentUser || {};
  const { entity_type, entity_id, ...rest } = details;
  state.adminDb.rpc('log_admin_audit', {
    p_lodge_id: targetLodgeId,
    p_lodge_name: targetLodgeName || null,
    p_action: action,
    p_actor_id: actor.id || null,
    p_actor_email: actor.email || null,
    p_entity_type: entity_type || null,
    p_entity_id: entity_id || null,
    p_details: rest
  }).then(() => {}).catch(() => {});
}

export async function getActivityLogs(filters = {}) {
  if (!state.isOnline) return [];
  const db = requireAdmin();
  const { data, error } = await db.rpc('get_admin_audit_log', {
    p_lodge_id: filters.lodge_id || null,
    p_actor_id: filters.actor_id || null,
    p_action: filters.action || null,
    p_start: filters.start || null,
    p_end: filters.end || null,
    p_limit: filters.limit || 200,
    p_offset: filters.offset || 0
  });
  if (error) {
    const { data: fallback } = await db.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(filters.limit || 200);
    return fallback || [];
  }
  return data || [];
}

export async function getAuditSummary(filters = {}) {
  if (!state.isOnline) return [];
  const db = requireAdmin();
  const { data, error } = await db.rpc('get_admin_audit_summary', {
    p_start: filters.start || null,
    p_end: filters.end || null
  });
  if (error) return [];
  return data || [];
}

// ─── ADMIN: COMPANY STATS ──────────────────────────────────────────────────────

export async function getCompanyStats(targetLodgeId) {
  if (!state.isOnline) return null;
  const db = requireAdmin();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const currentMonthWindow = getMonthWindowIso();
  const entitlement = await getAdminEntitlement(db, targetLodgeId).catch(async () =>
    (await import('./' + 'subscriptions.js')).getTrialStatus(targetLodgeId).catch(() => null)
  );
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

const LICENSE_SELECT = 'id, lodge_id, lodge_name, business_type, subscription_plan, subscription_state, payment_status, license_key, monthly_fee, currency, issued_at, expires_at, next_due_date, last_payment_date, notes, is_active, created_at, updated_at';
const LICENSE_LEGACY_SELECT = 'id, lodge_id, lodge_name, business_type, subscription_plan, payment_status, monthly_fee, currency, issued_at, expires_at, next_due_date, last_payment_date, notes, is_active';

function isLicenseSchemaCompatibilityError(error) {
  return /column licenses\.(subscription_state|license_key|created_at|updated_at) does not exist/i.test(String(error?.message || ''));
}

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const seg = (offset) => Array.from(bytes.slice(offset, offset + 4), (value) => chars[value % chars.length]).join('');
  return `BB-${seg(0)}-${seg(4)}-${seg(8)}`;
}

function coerceEntitlementPayload(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  return row.entitlement && typeof row.entitlement === 'object' ? row.entitlement : row;
}

function normalizeLicenseLodgeId(value) {
  return normalizeLodgeId(value) || null;
}

async function getAdminEntitlement(db, targetLodgeId) {
  if (!targetLodgeId) return null;
  const { data, error } = await db.rpc('get_lodge_entitlement', { p_lodge_id: targetLodgeId });
  if (error) throw new Error(error.message);
  return coerceEntitlementPayload(data);
}

function normalizeLicenseRow(license) {
  const paymentStatus = license.payment_status || 'active';
  const computedState = computeSubscriptionState({
    payment_status: paymentStatus,
    next_due_date: license.next_due_date || null,
    expires_at: license.expires_at || null,
    is_active: license.is_active !== false,
    grace_period_days: license.grace_period_days || DEFAULT_SUBSCRIPTION_GRACE_DAYS
  });
  const storedState = String(license.subscription_state || '').toLowerCase();
  const subscriptionState = storedState && storedState !== 'expired' ? storedState : computedState;
  return {
    ...license,
    lodge_id: normalizeLicenseLodgeId(license.lodge_id),
    subscription_state: subscriptionState,
    payment_status: paymentStatus,
    subscription_plan: normalizePlanName(license.subscription_plan)
  };
}

function licenseFromEntitlement(entitlement, company) {
  if (!entitlement) return null;
  const status = String(entitlement.status || '').toLowerCase();
  const subscriptionState = String(entitlement.subscription_state || '').toLowerCase();
  const paymentStatus = String(entitlement.payment_status || '').toLowerCase();
  const accessAllowed = entitlement.access_allowed === true || entitlement.allowed === true;
  const looksLicensed =
    ['licensed', 'active'].includes(status) ||
    ['licensed', 'active', 'trial', 'free', 'grace_period', 'overdue'].includes(subscriptionState) ||
    ['active', 'paid', 'trial', 'free', 'overdue'].includes(paymentStatus) ||
    accessAllowed;
  if (!looksLicensed) return null;
  const lodgeId = normalizeLicenseLodgeId(entitlement.lodge_id || company?.lodge_id);
  if (!lodgeId) return null;
  const licenseId = entitlement.source_license_id || entitlement.license_id || entitlement.id || `entitlement:${lodgeId}`;
  return normalizeLicenseRow({
    id: licenseId,
    lodge_id: lodgeId,
    lodge_name: entitlement.lodge_name || company?.lodge_name || company?.company_name || '',
    business_type: company?.business_type || 'lodge',
    subscription_plan: entitlement.plan || entitlement.subscription_plan || 'Starter',
    subscription_state: entitlement.subscription_state || 'active',
    payment_status: entitlement.payment_status || 'active',
    license_key: entitlement.license_key || entitlement.source_license_key || null,
    monthly_fee: Number(entitlement.monthly_fee || 0),
    currency: entitlement.currency || 'BWP',
    issued_at: entitlement.issued_at || null,
    expires_at: entitlement.expires_at || null,
    next_due_date: entitlement.next_due_date || null,
    last_payment_date: entitlement.last_payment_date || null,
    notes: entitlement.notes || null,
    is_active: true,
    created_at: entitlement.created_at || null,
    updated_at: entitlement.updated_at || null,
    _source: 'entitlement'
  });
}

async function fillMissingLicensesFromEntitlements(db, licenses) {
  const activeByLodge = new Set((licenses || []).
    filter((license) => license?.lodge_id && license.is_active !== false).
    map((license) => normalizeLicenseLodgeId(license.lodge_id)).
    filter(Boolean));
  const companies = await getAllCompanies().catch(async () => {
    const { data, error } = await db.
      from('settings').
      select(COMPANY_SETTINGS_MINIMAL_SELECT).
      limit(500);
    if (error) return [];
    return (data || []).map(normalizeCompanySettingsRow).filter((company) => company.lodge_id);
  });

  const targets = (companies || []).filter((company) => {
    const lodgeId = normalizeLicenseLodgeId(company?.lodge_id);
    return lodgeId && !activeByLodge.has(lodgeId);
  });
  if (targets.length === 0) return licenses;

  const entitlementRows = await Promise.allSettled(targets.map(async (company) => {
    const entitlement = await getAdminEntitlement(db, normalizeLicenseLodgeId(company.lodge_id));
    return licenseFromEntitlement(entitlement, company);
  }));
  const synthesized = entitlementRows.
    filter((result) => result.status === 'fulfilled' && result.value).
    map((result) => result.value);
  const merged = [...licenses];
  synthesized.forEach((license) => {
    const lodgeId = normalizeLicenseLodgeId(license.lodge_id);
    if (lodgeId && !activeByLodge.has(lodgeId)) {
      activeByLodge.add(lodgeId);
      merged.push(license);
    }
  });
  return merged;
}

export async function getLicenses() {
  if (!state.isOnline) return [];
  const db = requireAdmin();
  let { data, error } = await db.
    from('licenses').
    select(LICENSE_SELECT).
    order('issued_at', { ascending: false }).
    limit(500);
  if (error && isLicenseSchemaCompatibilityError(error)) {
    const fallback = await db.
      from('licenses').
      select(LICENSE_LEGACY_SELECT).
      order('issued_at', { ascending: false }).
      limit(500);
    data = (fallback.data || []).map((row) => ({
      ...row,
      subscription_state: row.payment_status || 'active',
      license_key: row.license_key || null,
      created_at: null,
      updated_at: null
    }));
    error = fallback.error;
  }
  if (error) throw new Error(error.message);
  const normalized = (data || []).map(normalizeLicenseRow);
  return fillMissingLicensesFromEntitlements(db, normalized);
}

export async function createLicense({ lodge_id, lodge_name, business_type, expires_at, notes, subscription_plan, payment_status, monthly_fee, currency, next_due_date, last_payment_date }) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  if (!lodge_id) throw new Error('createLicense requires a valid lodge_id');
  const normalizedPlan = normalizePlanName(subscription_plan);

  for (let attempt = 0; attempt < 5; attempt++) {
    const license_key = generateLicenseKey();
    const { data, error } = await requireAdmin().from('licenses').insert({
      lodge_id,
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
    console.warn('[License] issue_subscription_contract RPC not available, falling back to direct insert:', error.message);
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
  const db = requireAdmin();
  const update = { ...(updates || {}) };
  if (Object.prototype.hasOwnProperty.call(update, 'subscription_plan')) {
    update.subscription_plan = normalizePlanName(update.subscription_plan);
  }
  const contractFields = new Set([
    'lodge_id',
    'lodge_name',
    'business_type',
    'subscription_plan',
    'payment_status',
    'monthly_fee',
    'currency',
    'expires_at',
    'next_due_date',
    'last_payment_date',
    'notes'
  ]);
  const shouldUseSubscriptionRpc = Object.keys(update).some((key) => contractFields.has(key));
  if (shouldUseSubscriptionRpc) {
    try {
      const { data, error } = await db.rpc('update_subscription_contract', {
        p_license_id: id,
        p_payload: update
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Could not update subscription');
      return { success: true };
    } catch (error) {
      if (!isMissingEntitlementRpcError(error)) throw new Error(error.message);
      console.warn('[License] update_subscription_contract RPC not available, falling back to direct update:', error.message);
    }
  }
  const { error } = await db.from('licenses').update(update).eq('id', id);
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
    console.warn('[License] update_subscription_contract RPC not available, falling back to direct update:', error.message);
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
  select('id, lodge_id, lodge_name, subscription_plan, payment_status, next_due_date, is_active, monthly_fee, currency').
  lt('next_due_date', today).
  neq('payment_status', 'free').
  eq('is_active', true).
  limit(200);
  return data || [];
}

// ─── ADMIN: SUPPORT TICKETS ────────────────────────────────────────────────────

function getSupportAuthor(surface = 'desktop') {
  const user = state.currentUser || {};
  const isCommandCentral = user?.isMasterAdmin || String(user?.role || '').toLowerCase() === 'super_admin';
  return {
    sender_type: isCommandCentral ? 'command_central' : surface,
    sender_name: user?.name || user?.email || (isCommandCentral ? 'Command Central' : 'Front desk'),
    sender_role: user?.role || (isCommandCentral ? 'super_admin' : 'front desk'),
    sender_user_id: user?.id || '',
    sender_surface: isCommandCentral ? 'command_central' : surface
  };
}

async function attachSupportMessages(tickets = []) {
  if (!tickets.length) return [];
  try {
    const ids = tickets.map((ticket) => ticket.id).filter(Boolean);
    if (!ids.length) return normalizeSupportTickets(tickets);
    const { data, error } = await requireAdmin().
    from('support_ticket_messages').
    select('*').
    in('ticket_id', ids).
    order('created_at', { ascending: true });
    if (error) throw error;
    const byTicket = new Map();
    (data || []).forEach((message) => {
      const list = byTicket.get(message.ticket_id) || [];
      list.push(message);
      byTicket.set(message.ticket_id, list);
    });
    return normalizeSupportTickets(tickets.map((ticket) => ({
      ...ticket,
      messages: byTicket.get(ticket.id) || ticket.messages || []
    })));
  } catch {
    return normalizeSupportTickets(tickets);
  }
}

export async function getSupportTickets(filters = {}) {
  if (!state.isOnline) return [];
  let q = requireAdmin().from('support_tickets').select('id, lodge_id, lodge_name, title, description, status, priority, category, created_at, updated_at, messages');
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.priority) q = q.eq('priority', filters.priority);
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id);
  const { data } = await q.order('created_at', { ascending: false }).limit(200);
  return attachSupportMessages(data || []);
}

export async function createSupportTicket({ lodge_id, lodge_name, title, description, category, priority }) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const targetLodgeId = lodge_id || state.lodgeId;
  const author = getSupportAuthor('desktop');
  if (!state.adminDb) {
    const { data, error } = await state.supabase.rpc('create_support_ticket', {
      payload: {
        lodge_id: targetLodgeId,
        lodge_name: lodge_name || null,
        title,
        description,
        category: category || 'General',
        priority: priority || 'Normal',
        source: 'desktop_support_modal',
        ...author,
        requester_name: author.sender_name,
        requester_role: author.sender_role,
        requester_user_id: author.sender_user_id,
        requester_surface: author.sender_surface
      }
    });
    if (error) throw new Error(error.message);
    if (data?.success === false) throw new Error(data.error || 'Could not create support request');
    return { success: true, id: data?.id || null };
  }
  // Use the admin client when available (Command Central machine) to bypass RLS.
  const { data, error } = await state.adminDb.
  from('support_tickets').
  insert({
    lodge_id: targetLodgeId,
    lodge_name: lodge_name || null,
    title,
    description,
    category: category || 'General',
    priority: priority || 'Normal',
    status: 'open'
  }).
  select('id').
  single();
  if (error) throw new Error(error.message);
  if (data?.id) {
    await state.adminDb.from('support_ticket_messages').insert({
      ticket_id: data.id,
      lodge_id: targetLodgeId,
      body: description,
      ...author,
      metadata: { source: 'desktop_support_modal' }
    }).catch(() => {});
  }
  return { success: true, id: data?.id || null };
}

export async function getLodgeSupportTickets(limit = 20) {
  if (!state.isOnline) return [];
  const { data, error } = await state.supabase.rpc('get_lodge_support_tickets', {
    p_lodge_id: state.lodgeId,
    p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100)
  });
  if (error) throw new Error(error.message);
  return normalizeSupportTickets(data);
}

export async function getLodgeSupportTicketById(id) {
  if (!id || !state.isOnline) return null;
  const tickets = await getLodgeSupportTickets(100);
  return tickets.find((ticket) => ticket.id === id) || null;
}

export async function markLodgeSupportTicketRead(id, audience = 'front_desk', messageId = null) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data, error } = await state.supabase.rpc('mark_lodge_support_ticket_read', {
    p_ticket_id: id,
    p_lodge_id: state.lodgeId,
    p_audience: audience,
    p_message_id: messageId || null
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not update inbox read state');
  return data || { success: true };
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
  if ((error?.message || data?.error || '').toLowerCase().includes('invalid request status') && String(updates.status || '').toLowerCase() === 'closed') {
    const retry = await state.supabase.rpc('update_lodge_support_ticket', {
      p_ticket_id: id,
      p_lodge_id: state.lodgeId,
      p_status: 'resolved',
      p_admin_notes: Object.prototype.hasOwnProperty.call(updates, 'admin_notes') ?
      updates.admin_notes :
      null
    });
    if (retry.error) throw new Error(retry.error.message);
    if (retry.data?.success === false) throw new Error(retry.data.error || 'Could not update request');
    return { success: true, status: 'resolved' };
  }
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not update request');
  return { success: true };
}

export async function addLodgeSupportTicketMessage(id, payload = {}) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const author = getSupportAuthor('desktop');
  const { data, error } = await state.supabase.rpc('add_lodge_support_ticket_message', {
    p_ticket_id: id,
    p_lodge_id: state.lodgeId,
    p_body: payload.body || payload.message || '',
    p_sender_type: payload.sender_type || author.sender_type,
    p_sender_name: payload.sender_name || author.sender_name,
    p_sender_role: payload.sender_role || author.sender_role,
    p_sender_user_id: payload.sender_user_id || author.sender_user_id,
    p_sender_surface: payload.sender_surface || author.sender_surface,
    p_metadata: payload.metadata || {},
    p_status: payload.status || null
  });
  if ((error?.message || data?.error || '').toLowerCase().includes('invalid request status') && String(payload.status || '').toLowerCase() === 'closed') {
    const retry = await state.supabase.rpc('add_lodge_support_ticket_message', {
      p_ticket_id: id,
      p_lodge_id: state.lodgeId,
      p_body: payload.body || payload.message || '',
      p_sender_type: payload.sender_type || author.sender_type,
      p_sender_name: payload.sender_name || author.sender_name,
      p_sender_role: payload.sender_role || author.sender_role,
      p_sender_user_id: payload.sender_user_id || author.sender_user_id,
      p_sender_surface: payload.sender_surface || author.sender_surface,
      p_metadata: payload.metadata || {},
      p_status: 'resolved'
    });
    if (retry.error) throw new Error(retry.error.message);
    if (retry.data?.success === false) throw new Error(retry.data.error || 'Could not send reply');
    return { success: true, status: 'resolved' };
  }
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not send reply');
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
  const note = Object.prototype.hasOwnProperty.call(updates || {}, 'admin_notes') ?
  String(updates.admin_notes || '').trim() :
  '';
  if (note) {
    const { data: ticket } = await requireAdmin().
    from('support_tickets').
    select('id,lodge_id').
    eq('id', id).
    maybeSingle();
    const author = getSupportAuthor('command_central');
    if (ticket?.lodge_id) {
      await requireAdmin().from('support_ticket_messages').insert({
        ticket_id: id,
        lodge_id: ticket.lodge_id,
        body: note,
        ...author,
        metadata: { source: 'command_central_update' }
      }).catch(() => {});
    }
  }
  return { success: true };
}

export async function addSupportTicketMessage(id, payload = {}) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const ticketLodgeId = payload.lodge_id || (await requireAdmin().
  from('support_tickets').
  select('lodge_id').
  eq('id', id).
  maybeSingle()).data?.lodge_id;
  if (!ticketLodgeId) throw new Error('Request not found');
  const author = getSupportAuthor('command_central');
  const { data, error } = await requireAdmin().rpc('add_lodge_support_ticket_message', {
    p_ticket_id: id,
    p_lodge_id: ticketLodgeId,
    p_body: payload.body || payload.message || '',
    p_sender_type: payload.sender_type || author.sender_type,
    p_sender_name: payload.sender_name || author.sender_name,
    p_sender_role: payload.sender_role || author.sender_role,
    p_sender_user_id: payload.sender_user_id || author.sender_user_id,
    p_sender_surface: payload.sender_surface || author.sender_surface,
    p_metadata: payload.metadata || {},
    p_status: payload.status || null
  });
  if ((error?.message || data?.error || '').toLowerCase().includes('invalid request status') && String(payload.status || '').toLowerCase() === 'closed') {
    const retry = await requireAdmin().rpc('add_lodge_support_ticket_message', {
      p_ticket_id: id,
      p_lodge_id: ticketLodgeId,
      p_body: payload.body || payload.message || '',
      p_sender_type: payload.sender_type || author.sender_type,
      p_sender_name: payload.sender_name || author.sender_name,
      p_sender_role: payload.sender_role || author.sender_role,
      p_sender_user_id: payload.sender_user_id || author.sender_user_id,
      p_sender_surface: payload.sender_surface || author.sender_surface,
      p_metadata: payload.metadata || {},
      p_status: 'resolved'
    });
    if (retry.error) throw new Error(retry.error.message);
    if (retry.data?.success === false) throw new Error(retry.data.error || 'Could not send reply');
    return { success: true, status: 'resolved' };
  }
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not send reply');
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
  const { data } = await requireAdmin().from('broadcasts').select('id, title, message, is_active, expires_at, created_at, updated_at').order('created_at', { ascending: false }).limit(100);
  return data || [];
}

export async function getActiveBroadcasts() {
  if (!state.isOnline) return [];
  const now = new Date().toISOString();
  const { data } = await state.supabase.
  from('broadcasts').
  select('id, title, message, is_active, expires_at, created_at, updated_at').
  eq('is_active', true).
  or(`expires_at.is.null,expires_at.gt.${now}`).
  order('created_at', { ascending: false }).
  limit(100);
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

export async function getScheduledReleases() {
  if (!state.isOnline) return []
  const db = requireAdmin()
  const { data, error } = await db.rpc('get_scheduled_releases')
  if (error) return []
  return data || []
}

export async function expireOverdueFeatures() {
  if (!state.isOnline) return 0
  const db = requireAdmin()
  const { data, error } = await db.rpc('expire_overdue_features')
  if (error) return 0
  return data || 0
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
    entity_type: 'feature',
    entity_id: featureName,
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
    entity_type: 'feature',
    entity_id: featureName,
    feature_name: featureName
  });
  return { success: true };
}

export async function getAllLodgeFeatures() {
  if (!state.isOnline) return [];
  const { data } = await requireAdmin().  from('lodge_features').
  select('id, lodge_id, feature_key, enabled, created_at, updated_at').
  order('lodge_id').
  limit(500);
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
    entity_type: 'lodge',
    entity_id: targetLodgeId,
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

// ─── ADMIN: MARKETING LEADS ──────────────────────────────────────────────────

export async function getMarketingLeads(filters = {}) {
  if (!state.isOnline) return [];
  const db = requireAdmin();
  let query = db.from('marketing_leads').select('*').order('created_at', { ascending: false });
  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.stage) {
    query = query.eq('stage', filters.stage);
  }
  if (filters.interest) {
    query = query.eq('interest', filters.interest);
  }
  if (filters.follow_up_before) {
    query = query.lte('follow_up_at', filters.follow_up_before);
  }
  if (filters.limit) {
    query = query.limit(Number(filters.limit));
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function updateMarketingLeadStatus(id, status) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data, error } = await requireAdmin()
    .from('marketing_leads')
    .update({ status, stage: status })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateLeadCrm(id, fields) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const update = {}
  if (fields.stage !== undefined) { update.stage = fields.stage; update.status = fields.stage }
  if (fields.follow_up_at !== undefined) update.follow_up_at = fields.follow_up_at
  if (fields.sales_notes !== undefined) update.sales_notes = fields.sales_notes
  if (fields.estimated_value !== undefined) update.estimated_value = fields.estimated_value
  if (fields.probability !== undefined) update.probability = fields.probability
  if (fields.lost_reason !== undefined) update.lost_reason = fields.lost_reason
  if (fields.converted_lodge_id !== undefined) update.converted_lodge_id = fields.converted_lodge_id
  const { data, error } = await requireAdmin()
    .from('marketing_leads')
    .update(update)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data
}

export async function getSalesPipelineSummary() {
  if (!state.isOnline) return []
  const { data, error } = await requireAdmin().rpc('get_sales_pipeline_summary')
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}
