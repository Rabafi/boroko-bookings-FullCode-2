import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { state } from '../state.js';
import { readAuthCache, upsertCachedUser } from './authCache.js';
import { refreshCache } from './cacheRefresh.js';
import { checkOnline } from './connectivity.js';
import {
  createSupabaseAuthUserForStaff,
  fetchAuthenticateUserContract,
  getCachedUser,
  getLodgeAuthContext,
  removeAuthEntry,
  toSafeUser,
  upsertAuthEntry
} from './authLogin.js';
import {
  normalizeTrustedSessionRecord,
  pruneExpiredTrustedSessions,
  readSessionNonce
} from './authSession.js';
import {
  createAppError,
  isBackendAuthSchemaError,
  isUuid,
  normalizeEmail,
  normalizeLodgeId,
  normalizeUserRecord
} from './shared.js';
import { logActivity } from './operationalLog.js';
import { assertCreationWithinUsageLimit } from './usage.js';
import {
  buildPwaAccessInput,
  getAllUsers,
  normalizeCapabilityOverrides,
  normalizeStaffRole,
  resolvePwaAccessUpdate
} from './users.js';
import { readCache, writeCache } from './cacheStore.js';
import { normalizeStaffStatus } from '../../shared/accessControl.js';
import { normalizeSubscriptionPlan } from '../../shared/subscriptionPlans.js';
import { getAuthoritativeTrialStatus, getTrialStatus } from './entitlements.js';

const AUTH_CONTRACT_VERSION = 2;
const ADMIN_GUARD_STATUSES = new Set(['active', 'suspended']);
const SUPABASE_AUTH_USER_PAGE_SIZE = 1000;
const MANAGER_MANAGED_ROLES = new Set(['cashier', 'supervisor', 'receptionist', 'operations']);

/**
 * Expected user fields consumed after the existing users query normalizer or
 * by the local cache paths below. Cache values are not validated; these types
 * record existing consumer expectations only. Raw RPC result fields remain
 * unknown in AuthRpcExpectedResultView.
 * @typedef {{id: string, auth_user_id?: string|null, name?: string|null, email: string, password_hash?: string|null, role?: string|null, status?: string|null, lodge_id?: string|null, pin_hash?: string|null, pwa_enabled?: boolean|null, pwa_password_hash?: string|null, pwa_password_set_at?: string|null, pwa_password_reset_by?: string|null, pwa_disabled_reason?: string|null, allowed_outlet_ids?: unknown, capability_overrides?: unknown, last_sign_in_at?: string|null, last_desktop_sign_in_at?: string|null, last_pwa_sign_in_at?: string|null, last_activity_at?: string|null, invite_sent_at?: string|null, password_updated_at?: string|null, created_at?: string|null, isMasterAdmin?: boolean}} AuthUserExpectedView
 */

/** Expected data shape of the existing create/update staff IPC payloads; this is not runtime validation. @typedef {{id?: string, name?: string, email?: string, password?: string, role?: string, status?: string, pin?: unknown, allowed_outlet_ids?: unknown, capability_overrides?: unknown, pwa_enabled?: unknown, pwa_password?: unknown, pwa_password_hash?: unknown, pwa_disabled_reason?: unknown, pwa_reset_by?: unknown, _delete?: unknown, _audit?: unknown}} AuthUserMutationExpectedData */
/** @typedef {AuthUserMutationExpectedData & {name: string, email: string, password: string}} AuthUserCreateInputExpectedView */
/** @typedef {{current_pin?: unknown, currentPin?: unknown, new_pin?: unknown, newPin?: unknown}} StaffPinChangeInputExpectedView */
/** @typedef {{_delete?: unknown, _audit?: unknown, role?: unknown, capability_overrides?: unknown, pwa_enabled?: unknown, pwa_password?: unknown, pwa_disabled_reason?: unknown, allowed_outlet_ids?: unknown, status?: unknown}} StarterGuardDataExpectedView */
/** @typedef {{requested: false}|{requested: true, enabled: boolean, password_hash: string|null, autoDisableForRole: boolean, disabled_reason: string|null}} PwaAccessResolutionExpectedView */
/** @typedef {{data?: StarterGuardDataExpectedView, existingUser?: AuthUserExpectedView|null, hasExistingUsers?: boolean, allowArchive?: boolean}} StarterGuardOptionsExpectedView */
/** @typedef {{message?: unknown, code?: unknown, details?: unknown, hint?: unknown, stack?: unknown}} AuthErrorExpectedView */
/** @typedef {{staff_basic?: boolean, staff?: boolean, pwa?: boolean}} EntitlementFeatureExpectedView */
/**
 * Supabase RPC data has no runtime validation here. Error fields stay unknown;
 * the narrow string assertions at Error/createAppError call sites erase at
 * runtime and preserve the constructors' existing coercion behavior.
 * @typedef {{success?: unknown, id?: unknown, error?: unknown}} AuthRpcExpectedResultView
 */
/** @typedef {{found: boolean, authenticated: boolean, id: unknown, email: string, role: unknown, status: string, lodge_id: string|null, name: unknown, password_hash: unknown, last_sign_in_at: unknown, last_desktop_sign_in_at: unknown, last_pwa_sign_in_at: unknown, last_activity_at: unknown, invite_sent_at: unknown, password_updated_at: unknown, capability_overrides: Record<string, unknown>, session_token: unknown, session_expires_at: unknown}} AuthContractRowExpectedView */
/** @typedef {{ok: true, row: AuthContractRowExpectedView}|{ok: false, reason: string}} AuthContractResultExpectedView */
/** @typedef {{online: boolean, lodge_id: string|null, hasOfflineAccess: boolean, hasTrustedSession: boolean, savedSessionCount: number, hasCachedUsers: boolean, hasSavedAccounts: boolean, message: string}} AuthStatusResultExpectedView */
/**
 * @typedef {object} AuthHealthResultExpectedView
 * @property {boolean} ok
 * @property {string|null} code
 * @property {string} error
 * @property {{id?: unknown}|null} user
 * @property {boolean} online
 * @property {string|null} lodge_id
 * @property {number} contract_version
 * @property {'lodge'|null} settings_mode
 * @property {{lodge_id_is_uuid: boolean, settings_row_exists: boolean, settings_uses_uuid_contract: boolean, target_user_exists: boolean, authenticate_user_contract_valid: boolean}} checks
 */

async function getStarterUsersAccessMode() {
  const entitlement = await getTrialStatus(state.lodgeId, { forceFresh: state.isOnline });
  const plan = normalizeSubscriptionPlan(entitlement?.plan || entitlement?.subscription_plan || 'Starter');
  // The authoritative entitlement producer builds this map from
  // getPlanFeatureMap/mergeFeatureOverrides; only these existing flag reads
  // are projected here, and the response is not runtime-validated.
  const features = /** @type {EntitlementFeatureExpectedView|null|undefined} */ (entitlement?.effective_features) || {};
  return {
    isStarter: plan === 'Starter' && features.staff_basic !== false && features.staff !== true,
    entitlement
  };
}

/** @param {unknown} enabled */
async function assertPwaEntitlementForUpdate(enabled) {
  if (enabled !== true) return;
  if (state.isOnline !== true) {
    throw new Error('Manager mobile app access can only be enabled while online so the Pro entitlement can be verified.');
  }
  let entitlement;
  try {
    entitlement = await getAuthoritativeTrialStatus(state.lodgeId);
  } catch {
    throw new Error('Manager mobile app access could not be enabled because the live Pro entitlement could not be verified. Check the connection and try again.');
  }
  const features = /** @type {EntitlementFeatureExpectedView|null|undefined} */ (entitlement?.effective_features);
  if (features?.pwa !== true) {
    throw new Error('Manager mobile app access is not included in this subscription. Upgrade to Pro for mobile access.');
  }
}

/**
 * Main-process guard for Starter Users & Access Lite. The database trigger is
 * the final authority, but rejecting malformed requests here gives direct IPC
 * callers an immediate, actionable error and keeps offline queue payloads
 * within the same fixed-role contract.
 */
/** @param {StarterGuardOptionsExpectedView} [options] */
export async function assertStarterUsersAccessLite({ data = {}, existingUser = null, hasExistingUsers = false, allowArchive = false } = {}) {
  const { isStarter } = await getStarterUsersAccessMode();
  if (!isStarter) return false;

  if (data?._delete === true) {
    throw new Error('Starter supports suspend and reactivate only. Permanent account deletion is available on Standard.');
  }
  if (data?._audit === true) {
    throw new Error('The server-backed access audit viewer is included with Standard. Starter records changes but does not expose the audit viewer.');
  }

  const requestedRole = data?.role ? normalizeStaffRole(data.role) : normalizeStaffRole(existingUser?.role);
  const existingRole = normalizeStaffRole(existingUser?.role);
  const isExistingOwner = Boolean(existingUser) && existingRole === 'admin' && requestedRole === 'admin';
  if (!existingUser && !hasExistingUsers && requestedRole !== 'admin') {
    throw new Error('The first lodge user must use the Admin role template.');
  }
  if (!existingUser && hasExistingUsers && requestedRole && !['receptionist', 'operations'].includes(requestedRole)) {
    throw new Error('Starter additional users must use the Receptionist or Operations role template.');
  }
  if (existingUser && data?.role && !['receptionist', 'operations'].includes(requestedRole) && !isExistingOwner) {
    throw new Error('Starter additional users must use the Receptionist or Operations role template.');
  }
  if (Object.prototype.hasOwnProperty.call(data || {}, 'capability_overrides')
      && Object.keys(normalizeCapabilityOverrides(data.capability_overrides)).length > 0) {
    throw new Error('Starter uses fixed role templates. Custom permission exceptions require Standard.');
  }
  if (data?.pwa_enabled === true || data?.pwa_password || data?.pwa_disabled_reason) {
    throw new Error('Manager mobile access is not included in Starter. Upgrade to Pro for mobile access.');
  }
  if (Object.prototype.hasOwnProperty.call(data || {}, 'allowed_outlet_ids')
      && Array.isArray(data.allowed_outlet_ids) && data.allowed_outlet_ids.length > 0) {
    throw new Error('Outlet-scoped access is not included in Starter Users & Access.');
  }
  if (!allowArchive && data?.status && normalizeStaffStatus(data.status) === 'archived') {
    throw new Error('Starter supports suspend and reactivate only. Archive is available on Standard.');
  }
  return true;
}

function currentUserCanAdministerStaff() {
  const user = state.currentUser;
  if (user?.isMasterAdmin) return true;
  return ['manager', 'admin', 'super_admin'].includes(normalizeStaffRole(user?.role));
}

async function hasExistingLodgeUsers() {
  const lodgeId = normalizeLodgeId(state.lodgeId);
  if (!lodgeId) return true;
  if (state.isOnline && state.supabase) {
    const { data, error } = await state.supabase
      .from('users')
      .select('id')
      .eq('lodge_id', lodgeId)
      .limit(1);
    if (!error) return (data || []).length > 0;
  }
  return /** @type {AuthUserExpectedView[]} */ (readCache('users'))
    .map(normalizeUserRecord)
    .filter((user) => user !== null)
    .some((user) => normalizeLodgeId(user.lodge_id) === lodgeId);
}

/** @param {{allowInitialSetup?: boolean}} [options] */
async function requireStaffAdmin({ allowInitialSetup = false } = {}) {
  if (currentUserCanAdministerStaff()) return;
  if (allowInitialSetup && !(await hasExistingLodgeUsers())) return;
  throw new Error('Only a manager or admin can manage staff accounts.');
}

/** @param {string} label @param {unknown} [payload] */
function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  try {
    console.log(`[AUTH TRACE] ${label}`, payload);
  } catch {
    // Best-effort debug logging only.
  }
}

/** @param {Parameters<NonNullable<typeof state.queueOperation>>} args */
function queueOperationBridge(...args) {
  if (typeof state.queueOperation !== 'function') {
    throw new Error('Queue operation runtime is not available.');
  }
  return state.queueOperation(...args);
}

function nowIso() {
  return new Date().toISOString();
}

/** @param {import('@supabase/supabase-js').SupabaseClient} adminClient @param {string} emailLower */
async function findSupabaseAuthUserByEmail(adminClient, emailLower) {
  if (!adminClient || !emailLower) return null;
  // Supabase Auth does not provide an email-filtered admin lookup. Do not put
  // an arbitrary cap on this traversal: a pre-existing identity beyond that
  // cap would make multi-company setup try to create it again and surface a
  // false "email already used" error. This path runs only while reconciling a
  // staff account with its one shared Supabase Auth identity.
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: SUPABASE_AUTH_USER_PAGE_SIZE
    });
    if (error) throw new Error(error.message || 'Could not search Supabase Auth users.');
    const users = Array.isArray(data?.users) ? data.users : [];
    const match = users.find((authUser) => normalizeEmail(authUser?.email) === emailLower);
    if (match) return match;
    if (users.length < SUPABASE_AUTH_USER_PAGE_SIZE) return null;
  }
}

/** @param {unknown} error */
function isSupabaseAuthEmailAlreadyRegisteredError(error) {
  const errorView = /** @type {AuthErrorExpectedView|null|undefined} */ (error);
  const message = String(errorView?.message || error || '');
  return /user already registered|email.+already.+(?:registered|exists)|duplicate.+(?:email|user)|already exists/i.test(message);
}

/** @param {import('@supabase/supabase-js').SupabaseClient} adminClient @param {string} authUserId @param {string} password @param {Record<string, unknown>} metadata */
async function updateSupabaseAuthStaffUser(adminClient, authUserId, password, metadata) {
  const { data, error } = await adminClient.auth.admin.updateUserById(authUserId, {
    password,
    email_confirm: true,
    user_metadata: metadata
  });
  if (error) throw new Error(error.message || 'Could not update Supabase Auth password.');
  return data?.user?.id || authUserId;
}

/** @param {AuthUserExpectedView} user @param {string} password @param {{adminClient?: import('@supabase/supabase-js').SupabaseClient|null, lodgeId?: unknown}} [options] */
export async function ensureSupabaseAuthStaffUserReady(user, password, options = {}) {
  const adminClient = options.adminClient || state.adminDb;
  const lodgeId = normalizeLodgeId(options.lodgeId || user?.lodge_id || state.lodgeId);
  const emailLower = normalizeEmail(user?.email);
  if (!state.isOnline || !adminClient || !emailLower || !password) return null;

  const metadata = {
    lodge_id: lodgeId || null,
    app_user_id: user?.id || null,
    app: 'boroko-bookings'
  };

  let authUserId = user?.auth_user_id || null;
  if (!authUserId) {
    const existingAuthUser = await findSupabaseAuthUserByEmail(adminClient, emailLower);
    authUserId = existingAuthUser?.id || null;
  }

  if (authUserId) {
    authUserId = await updateSupabaseAuthStaffUser(adminClient, authUserId, password, metadata);
  } else {
    const { data, error } = await adminClient.auth.admin.createUser({
      email: emailLower,
      password,
      email_confirm: true,
      user_metadata: metadata
    });
    if (!error) {
      authUserId = data?.user?.id || null;
    } else if (isSupabaseAuthEmailAlreadyRegisteredError(error)) {
      // Another setup may have created the Auth identity between our lookup
      // and create call. Re-read, update it, and link this company profile
      // instead of treating the shared email as a failed setup.
      const existingAuthUser = await findSupabaseAuthUserByEmail(adminClient, emailLower);
      if (!existingAuthUser?.id) {
        throw new Error(error.message || 'Could not create confirmed Supabase Auth user.');
      }
      authUserId = await updateSupabaseAuthStaffUser(adminClient, existingAuthUser.id, password, metadata);
    } else {
      throw new Error(error.message || 'Could not create confirmed Supabase Auth user.');
    }
  }

  if (authUserId && user?.id && lodgeId && user.auth_user_id !== authUserId) {
    const { error } = await adminClient
      .from('users')
      .update({ auth_user_id: authUserId })
      .eq('id', user.id)
      .eq('lodge_id', lodgeId);
    if (error) throw new Error(error.message || 'Could not link Supabase Auth user to staff profile.');
    upsertCachedUser({ ...user, auth_user_id: authUserId });
  }

  return authUserId;
}

/** @param {AuthUserExpectedView|null|undefined} user */
function isProtectedAdmin(user) {
  return normalizeStaffRole(user?.role) === 'admin' && ADMIN_GUARD_STATUSES.has(normalizeStaffStatus(user?.status));
}

/** @param {AuthUserExpectedView[]} [users] @param {unknown} [excludingId] */
function countProtectedAdmins(users = [], excludingId = null) {
  return users.filter((user) => user?.id !== excludingId && isProtectedAdmin(user)).length;
}

/** @param {string} [email] @param {{expectedUserId?: unknown}} [options] @returns {Promise<AuthHealthResultExpectedView|{ok: false, code: string, error: string, user: null, online: boolean, lodge_id: null, contract_version: number, settings_mode: null, checks: AuthHealthResultExpectedView['checks']}>} */
export async function runAuthHealthCheck(email = '', options = {}) {
  authTrace('healthCheck start', { email: normalizeEmail(email), lodge_id: state.lodgeId });
  await checkOnline();
  if (!state.lodgeId) {
    const result = {
      ok: false,
      code: 'no_profile_selected',
      error: 'Choose a lodge profile on this computer before running the auth health check.',
      user: null,
      online: state.isOnline,
      lodge_id: null,
      contract_version: AUTH_CONTRACT_VERSION,
      settings_mode: null,
      checks: {
        lodge_id_is_uuid: false,
        settings_row_exists: false,
        settings_uses_uuid_contract: false,
        target_user_exists: false,
        authenticate_user_contract_valid: false
      }
    };
    authTrace('healthCheck return', result);
    return result;
  }
  const emailLower = normalizeEmail(email);
  const expectedUserId = isUuid(options?.expectedUserId) ? options.expectedUserId : null;
  const health = /** @type {AuthHealthResultExpectedView} */ ({
    ok: false,
    code: null,
    error: '',
    user: null,
    online: state.isOnline,
    lodge_id: state.lodgeId,
    contract_version: AUTH_CONTRACT_VERSION,
    settings_mode: null,
    checks: {
      lodge_id_is_uuid: isUuid(state.lodgeId),
      settings_row_exists: false,
      settings_uses_uuid_contract: false,
      target_user_exists: !emailLower,
      authenticate_user_contract_valid: false
    }
  });

  console.log('[AUTH HEALTH] start:', {
    email: emailLower || null,
    lodge_id: state.lodgeId,
    expected_user_id: expectedUserId
  });

  if (!health.checks.lodge_id_is_uuid) {
    health.code = 'invalid_lodge_id';
    health.error = 'This device is not linked to a valid UUID lodge ID.';
    authTrace('healthCheck return', health);
    return health;
  }

  if (!state.isOnline) {
    health.code = 'offline';
    health.error = 'An internet connection is required to validate the desktop auth contract.';
    authTrace('healthCheck return', health);
    return health;
  }

  try {
    const authContext = await getLodgeAuthContext();
    health.settings_mode = authContext ? 'lodge' : null;
    health.checks.settings_row_exists = !!authContext;
    health.checks.settings_uses_uuid_contract =
    isUuid(authContext?.lodge_id) &&
    normalizeLodgeId(authContext?.lodge_id) === normalizeLodgeId(state.lodgeId) &&
    Object.prototype.hasOwnProperty.call(authContext || {}, 'deleted');
  } catch (e) {
    const errorView = /** @type {AuthErrorExpectedView} */ (e);
    health.code = isBackendAuthSchemaError(/** @type {string} */ (errorView.message || '')) ? 'backend_auth_schema_outdated' : 'health_check_failed';
    health.error = isBackendAuthSchemaError(/** @type {string} */ (errorView.message || '')) ?
    'The backend lodge auth context schema is outdated for this desktop auth flow. Run the checked-in auth migrations, then try again.' :
    /** @type {string} */ (errorView.message);
    authTrace('healthCheck return', health);
    return health;
  }

  if (!health.checks.settings_uses_uuid_contract) {
    health.code = 'backend_auth_schema_outdated';
    health.error = 'This app now requires UUID-based lodge settings rows with the latest auth migrations applied.';
    authTrace('healthCheck return', health);
    return health;
  }

  const probeEmail = emailLower || '__auth_health_check__@invalid.local';
  const { rpcResult, contract: rawContract } = await fetchAuthenticateUserContract(probeEmail);
  const contract = /** @type {AuthContractResultExpectedView} */ (rawContract);
  // Supabase PostgrestError.message and the helper's catch-path message are
  // strings at this producer boundary. Other RPC fields remain untrusted.
  const rpcErrorView = /** @type {{message?: string|null}|null|undefined} */ (rpcResult?.error);
  if (rpcErrorView) {
    health.code = isBackendAuthSchemaError(rpcErrorView.message || '') ? 'backend_auth_schema_outdated' : 'health_check_failed';
    health.error = isBackendAuthSchemaError(rpcErrorView.message || '') ?
    'The canonical authenticate_user function is missing or outdated. Run the checked-in auth migrations, then try again.' :
    /** @type {string} */ (rpcErrorView.message);
    authTrace('healthCheck return', health);
    return health;
  }

  if (!contract.ok) {
    health.code = 'backend_auth_schema_outdated';
    health.error = 'The canonical authenticate_user function returned an outdated contract shape.';
    authTrace('healthCheck return', health);
    return health;
  }

  const probeRow = contract.row;
  if (normalizeLodgeId(probeRow.lodge_id) !== normalizeLodgeId(state.lodgeId)) {
    health.code = 'backend_auth_schema_outdated';
    health.error = 'The canonical authenticate_user function returned a lodge_id that does not match this device.';
    authTrace('healthCheck return', health);
    return health;
  }

  if (emailLower) {
    if (probeRow.found) {
      health.checks.target_user_exists = true;
      health.user = toSafeUser(probeRow);
    } else {
      if (expectedUserId) {
        health.code = 'health_check_failed';
        health.error =
        'The new admin account was created, but the canonical authenticate_user check could not verify it for this lodge.';
        authTrace('healthCheck return', health);
        return health;
      }
      health.code = 'target_user_missing';
      health.error = 'The target user was not found for this lodge.';
      authTrace('healthCheck return', health);
      return health;
    }

    if (expectedUserId && probeRow.id !== expectedUserId) {
      health.code = 'backend_auth_schema_outdated';
      health.error = 'The canonical authenticate_user function returned a different user than the one just created for this lodge.';
      authTrace('healthCheck return', health);
      return health;
    }
    if (probeRow.email !== emailLower) {
      health.code = 'backend_auth_schema_outdated';
      health.error = 'The canonical authenticate_user function returned a user that does not match the requested lodge-scoped email.';
      authTrace('healthCheck return', health);
      return health;
    }
  } else if (probeRow.found) {
    health.code = 'backend_auth_schema_outdated';
    health.error = 'The canonical authenticate_user function unexpectedly returned a user during the health-check probe.';
    authTrace('healthCheck return', health);
    return health;
  }

  health.checks.authenticate_user_contract_valid = true;
  health.ok = true;
  health.code = 'ok';
  health.error = '';
  console.log('[AUTH HEALTH] success:', {
    email: emailLower || null,
    lodge_id: state.lodgeId,
    user_id: health.user?.id || null
  });
  authTrace('healthCheck return', health);
  return health;
}

/** @param {AuthUserCreateInputExpectedView} data */
export async function createUser(data) {
  await requireStaffAdmin({ allowInitialSetup: true });
  const currentUsers = /** @type {AuthUserExpectedView[]} */ (state.isOnline ? await getAllUsers() : readCache('users'));
  await assertStarterUsersAccessLite({ data, hasExistingUsers: currentUsers.length > 0 });
  assertManagerCanManageRole(data?.role);
  if (currentUserIsLimitedStaffManager() && Object.keys(data?.capability_overrides || {}).length > 0) {
    throw new Error('Managers cannot set custom permission exceptions. Ask an administrator to make this access change.');
  }
  await assertCreationWithinUsageLimit('user', { forceRemoteRefresh: state.isOnline });
  const emailLower = data.email.trim().toLowerCase();
  if (state.isOnline) {
    const query = /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).from('users').select('id').eq('email', emailLower).eq('lodge_id', state.lodgeId);
    const { data: existing } = await query.limit(1);
    if (existing && existing.length > 0) {
      throw new Error(`A user with the email "${emailLower}" already exists in this lodge.`);
    }
  } else {
    const cached = /** @type {AuthUserExpectedView[]} */ (readCache('users'));
    const duplicate = cached.some((u) => u.email?.toLowerCase() === emailLower && u.lodge_id === state.lodgeId);
    if (duplicate) {
      throw new Error(`A user with the email "${emailLower}" already exists in this lodge.`);
    }
  }

  const hash = bcrypt.hashSync(data.password, 10);
  const pwaAccess = /** @type {PwaAccessResolutionExpectedView} */ (resolvePwaAccessUpdate({}, data));
  await assertPwaEntitlementForUpdate(pwaAccess.requested ? pwaAccess.enabled : undefined);
  const id = randomUUID();
  const user = /** @type {AuthUserExpectedView} */ ({
    id,
    auth_user_id: null,
    name: data.name,
    email: emailLower,
    password_hash: hash,
    role: normalizeStaffRole(data.role),
    status: normalizeStaffStatus(data.status),
    lodge_id: state.lodgeId,
    last_sign_in_at: null,
    last_desktop_sign_in_at: null,
    last_pwa_sign_in_at: null,
    last_activity_at: null,
    invite_sent_at: null,
    password_updated_at: nowIso(),
    pwa_enabled: pwaAccess.requested ? pwaAccess.enabled === true : false,
    pwa_password_hash: pwaAccess.requested ? pwaAccess.password_hash : undefined,
    pwa_password_set_at: pwaAccess.requested && pwaAccess.password_hash ? new Date().toISOString() : null,
    pwa_password_reset_by: pwaAccess.requested && pwaAccess.password_hash ? state.currentUser?.id || null : null,
    pwa_disabled_reason: pwaAccess.enabled === true ? null : pwaAccess.requested ? pwaAccess.disabled_reason : null,
    allowed_outlet_ids: Array.isArray(data.allowed_outlet_ids) ? data.allowed_outlet_ids : [],
    capability_overrides: normalizeCapabilityOverrides(data.capability_overrides)
  });
  if (data.pin) {
    user.pin_hash = bcrypt.hashSync(String(data.pin).trim(), 10);
  }

  if (state.isOnline) {
    const { data: rawResult, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_user', { payload: user });
    const result = /** @type {AuthRpcExpectedResultView|null} */ (rawResult);
    if (error) {
      const message = error.message || '';
      if (/users_admin_email_unique/i.test(message)) {
        throw createAppError(
          'admin_email_global_unique_stale',
          'This database still enforces a global admin-email unique rule that blocks multi-company setup. Apply migration 20260712153000_drop_global_admin_email_unique.sql, then retry.',
          { email: emailLower, lodge_id: state.lodgeId }
        );
      }
      if (/users_email_lodge_unique|users_lodge_id_email_key|already exists/i.test(message)) {
        throw createAppError(
          'user_email_exists_in_company',
          `A user with the email "${emailLower}" already exists in this company.`,
          { email: emailLower, lodge_id: state.lodgeId }
        );
      }
      const code = isBackendAuthSchemaError(message) ? 'backend_auth_schema_outdated' : 'user_create_failed';
      const prefix = code === 'backend_auth_schema_outdated' ?
      'This database is missing the latest Tsa Bonno auth schema required to create staff accounts for a company.' :
      'Could not create the staff account for this company.';
      throw createAppError(code, `${prefix} ${message}`.trim(), { email: emailLower, lodge_id: state.lodgeId });
    }
    if (!result?.success || !result?.id) {
      throw createAppError(
        'user_create_failed',
        /** @type {string} */ (result?.error || 'Supabase did not return the new staff account after insert.'),
        { email: emailLower, lodge_id: state.lodgeId }
      );
    }
    try {
      if (state.adminDb) {
        await ensureSupabaseAuthStaffUserReady(
          /** @type {AuthUserExpectedView} */ ({ ...user, id: result.id, auth_user_id: null }),
          data.password
        );
      } else {
        await createSupabaseAuthUserForStaff(emailLower, data.password);
      }
    } catch (authError) {
      const authErrorView = /** @type {AuthErrorExpectedView|null|undefined} */ (authError);
      console.error('[AUTH] Staff profile was created but Supabase Auth preparation failed:', {
        email: emailLower,
        lodge_id: state.lodgeId,
        user_id: result.id,
        message: authErrorView?.message || 'unknown_error'
      });
    }
    if (pwaAccess.requested) {
      const { data: rawPwaResult, error: pwaError } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('set_user_pwa_access', {
        p_id: result.id,
        p_lodge_id: state.lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: state.currentUser?.id || null
      });
      const pwaResult = /** @type {AuthRpcExpectedResultView|null} */ (rawPwaResult);
      if (pwaError) {
        throw createAppError('pwa_access_update_failed', pwaError.message || 'Could not prepare manager mobile app access.', {
          email: emailLower,
          lodge_id: state.lodgeId,
          user_id: result.id
        });
      }
      if (!pwaResult?.success) {
        throw createAppError(
          'pwa_access_update_failed',
          /** @type {string} */ (pwaResult?.error || 'Could not prepare manager mobile app access.'),
          { email: emailLower, lodge_id: state.lodgeId, user_id: result.id }
        );
      }
    }
    upsertCachedUser({
      id: result.id,
      auth_user_id: user.auth_user_id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      lodge_id: user.lodge_id,
      pin_hash: user.pin_hash || null,
      last_sign_in_at: null,
      last_desktop_sign_in_at: null,
      last_pwa_sign_in_at: null,
      last_activity_at: null,
      invite_sent_at: null,
      password_updated_at: user.password_updated_at,
      pwa_enabled: user.pwa_enabled,
      pwa_password_set_at: user.pwa_password_set_at,
      pwa_password_reset_by: user.pwa_password_reset_by,
      pwa_disabled_reason: user.pwa_disabled_reason,
      created_at: new Date().toISOString()
    });
    await refreshCache('users');
    if (!getCachedUser(emailLower)) {
      upsertCachedUser({
        id: result.id,
        auth_user_id: user.auth_user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        lodge_id: user.lodge_id,
        pin_hash: user.pin_hash || null,
        last_sign_in_at: null,
        last_desktop_sign_in_at: null,
        last_pwa_sign_in_at: null,
        last_activity_at: null,
        invite_sent_at: null,
        password_updated_at: user.password_updated_at,
        pwa_enabled: user.pwa_enabled,
        pwa_password_set_at: user.pwa_password_set_at,
        pwa_password_reset_by: user.pwa_password_reset_by,
        pwa_disabled_reason: user.pwa_disabled_reason,
        created_at: new Date().toISOString()
      });
    }
    if (pwaAccess.requested) {
      const action = user.pwa_enabled ? 'enabled' : 'prepared';
      logActivity('pwa_access_updated', `${user.name || user.email} · manager mobile app ${action}`);
    }
    logActivity('staff_account_created', `${user.name || user.email} · ${user.role} account added`);
    return result?.id;
  }

  const cached = /** @type {AuthUserExpectedView[]} */ (readCache('users'));
  const newUser = {
    ...user,
    created_at: new Date().toISOString()
  };

  cached.push(newUser);
  writeCache('users', cached);

  await queueOperationBridge('rpc', 'create_user', { payload: newUser }, null, { _queue_id: `user-${id}` });
  if (pwaAccess.requested) {
    await queueOperationBridge('rpc', 'set_user_pwa_access', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_enabled: pwaAccess.enabled,
      p_password_hash: pwaAccess.password_hash,
      p_disabled_reason: pwaAccess.disabled_reason,
      p_reset_by: state.currentUser?.id || null
    }, null, { _depends_on: `user-${id}` });
  }

  if (pwaAccess.requested) {
    const action = user.pwa_enabled ? 'enabled' : 'prepared';
    logActivity('pwa_access_updated', `${user.name || user.email} · manager mobile app ${action}`);
  }

  logActivity('staff_account_created', `${user.name || user.email} · ${user.role} account added locally and queued for sync`);

  return id;
}

function currentUserIsLimitedStaffManager() {
  return !state.currentUser?.isMasterAdmin && normalizeStaffRole(state.currentUser?.role) === 'manager';
}

/** @param {unknown} role */
function assertManagerCanManageRole(role) {
  if (currentUserIsLimitedStaffManager() && !MANAGER_MANAGED_ROLES.has(normalizeStaffRole(role))) {
    throw new Error('Managers can manage service-team accounts only. An administrator must assign finance, manager, or owner access.');
  }
}

/** @param {string} id @param {AuthUserMutationExpectedData} data */
export async function updateUser(id, data) {
  await requireStaffAdmin();
  const cachedUsers = /** @type {AuthUserExpectedView[]} */ (readCache('users'));
  const existingUser = cachedUsers.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  await assertStarterUsersAccessLite({ data, existingUser });
  assertManagerCanManageRole(existingUser.role);
  assertManagerCanManageRole(data?.role || existingUser.role);
  if (currentUserIsLimitedStaffManager() && Object.prototype.hasOwnProperty.call(data || {}, 'capability_overrides')) {
    const requestedOverrides = normalizeCapabilityOverrides(data.capability_overrides);
    const currentOverrides = normalizeCapabilityOverrides(existingUser.capability_overrides);
    if (JSON.stringify(requestedOverrides) !== JSON.stringify(currentOverrides)) {
      throw new Error('Managers cannot set custom permission exceptions. Ask an administrator to make this access change.');
    }
  }
  const update = /** @type {Record<string, unknown>} */ ({});
  if (Object.prototype.hasOwnProperty.call(data, 'name')) update.name = data.name;
  if (Object.prototype.hasOwnProperty.call(data, 'email') && data.email) update.email = data.email.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(data, 'role')) update.role = normalizeStaffRole(data.role);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) update.status = normalizeStaffStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'allowed_outlet_ids')) {
    update.allowed_outlet_ids = Array.isArray(data.allowed_outlet_ids) ? data.allowed_outlet_ids : [];
  }
  if (Object.prototype.hasOwnProperty.call(data, 'capability_overrides')) {
    update.capability_overrides = normalizeCapabilityOverrides(data.capability_overrides);
  }
  const password_hash = data.password ? bcrypt.hashSync(data.password, 10) : null;
  if (data.pin) {
    update.pin_hash = bcrypt.hashSync(String(data.pin).trim(), 10);
  }
  if (password_hash) {
    update.password_updated_at = nowIso();
  }
  const pwaAccess = /** @type {PwaAccessResolutionExpectedView} */ (resolvePwaAccessUpdate(existingUser, buildPwaAccessInput(data)));
  await assertPwaEntitlementForUpdate(pwaAccess.requested ? pwaAccess.enabled : undefined);
  const nextRole = update.role || existingUser.role;
  const nextStatus = update.status || existingUser.status;
  const currentStatus = normalizeStaffStatus(existingUser.status);
  const becomingProtectedAdmin = normalizeStaffRole(nextRole) === 'admin' && ADMIN_GUARD_STATUSES.has(normalizeStaffStatus(nextStatus));
  const remainsProtectedAdmin = isProtectedAdmin(existingUser) && becomingProtectedAdmin;

  if (state.currentUser?.id === id && normalizeStaffStatus(nextStatus) !== 'active') {
    throw new Error('You cannot suspend or archive the account you are currently signed in with.');
  }

  if (state.currentUser?.id === id && normalizeStaffRole(nextRole) !== normalizeStaffRole(existingUser.role)) {
    throw new Error('You cannot change the role of the account you are currently signed in with.');
  }

  if (isProtectedAdmin(existingUser) && !remainsProtectedAdmin && countProtectedAdmins(cachedUsers, id) === 0) {
    throw new Error('You cannot remove or archive the last admin in this lodge.');
  }

  if (state.isOnline) {
    if (Object.keys(update).length > 0) {
      const { data: rawResult, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_user_profile', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        payload: update
      });
      const result = /** @type {AuthRpcExpectedResultView|null} */ (rawResult);
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(/** @type {string} */ (result?.error || 'Could not update user'));
    }
    if (password_hash) {
      const { data: rawPasswordResult, error: passwordError } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('set_user_password', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_password_hash: password_hash
      });
      const passwordResult = /** @type {AuthRpcExpectedResultView|null} */ (rawPasswordResult);
      if (passwordError) throw new Error(passwordError.message);
      if (!passwordResult?.success) throw new Error(/** @type {string} */ (passwordResult?.error || 'Could not update user password'));
      await ensureSupabaseAuthStaffUserReady(/** @type {AuthUserExpectedView} */ ({ ...existingUser, id, ...update }), /** @type {string} */ (data.password));
    }
    if (pwaAccess.requested) {
      const { data: rawPwaResult, error: pwaError } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('set_user_pwa_access', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: state.currentUser?.id || null
      });
      const pwaResult = /** @type {AuthRpcExpectedResultView|null} */ (rawPwaResult);
      if (pwaError) throw new Error(pwaError.message);
      if (!pwaResult?.success) throw new Error(/** @type {string} */ (pwaResult?.error || 'Could not update manager mobile app access'));
    }
    await refreshCache('users');
  } else {
    const cached = [...cachedUsers];
    const idx = cached.findIndex((u) => u.id === id);
    if (idx >= 0) {
      cached[idx] = { ...cached[idx], ...update };
      if (password_hash) cached[idx].password_hash = password_hash;
      if (pwaAccess.requested) {
        cached[idx].pwa_enabled = pwaAccess.enabled;
        cached[idx].pwa_disabled_reason = pwaAccess.disabled_reason;
        if (pwaAccess.password_hash) {
          cached[idx].pwa_password_hash = pwaAccess.password_hash;
          cached[idx].pwa_password_set_at = new Date().toISOString();
          cached[idx].pwa_password_reset_by = state.currentUser?.id || null;
        }
      }
    }
    writeCache('users', cached);
    if (Object.keys(update).length > 0) {
      await queueOperationBridge('rpc', 'update_user_profile', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        payload: update
      });
    }
    if (password_hash) {
      await queueOperationBridge('rpc', 'set_user_password', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_password_hash: password_hash
      });
    }
    if (pwaAccess.requested) {
      await queueOperationBridge('rpc', 'set_user_pwa_access', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: state.currentUser?.id || null
      });
    }
  }

  if (existingUser?.email && update.email && existingUser.email !== update.email) {
    removeAuthEntry(existingUser.email);
  }
  if (password_hash) {
    upsertAuthEntry((update.email || existingUser?.email || '').trim().toLowerCase(), password_hash);
  }
  if (pwaAccess.requested) {
    const subject = update.name || existingUser?.name || update.email || existingUser?.email || 'Staff account';
    const action = pwaAccess.enabled ?
    pwaAccess.password_hash ? 'enabled with a new mobile app password' : 'enabled' :
    pwaAccess.autoDisableForRole ? `suspended because the role changed to ${update.role || existingUser?.role}` : 'disabled';
    logActivity('pwa_access_updated', `${subject} · manager mobile app ${action}`);
  }
  if (Object.prototype.hasOwnProperty.call(update, 'status')) {
    logActivity('staff_status_updated', `${update.name || existingUser?.name || existingUser?.email || 'Staff account'} · status set to ${update.status}`);
  }
  const changedAccountFields = [
    Object.prototype.hasOwnProperty.call(update, 'name') ? 'name' : null,
    Object.prototype.hasOwnProperty.call(update, 'email') ? 'email' : null,
    Object.prototype.hasOwnProperty.call(update, 'role') ? 'role' : null,
    Object.prototype.hasOwnProperty.call(update, 'allowed_outlet_ids') ? 'outlet access' : null,
    Object.prototype.hasOwnProperty.call(update, 'capability_overrides') ? 'permission exceptions' : null
  ].filter(Boolean)
  if (changedAccountFields.length > 0) {
    logActivity('staff_account_updated', `${update.name || existingUser?.name || existingUser?.email || 'Staff account'} · ${changedAccountFields.join(', ')} updated`)
  }
}

/** @param {number|string} [limit] */
export async function getStaffAccessAudit(limit = 100) {
  await requireStaffAdmin()
  await assertStarterUsersAccessLite({ data: { _audit: true } });
  await checkOnline()
  if (!state.isOnline || !state.supabase) {
    throw new Error('Connect to the internet to view the server-backed staff access audit.')
  }

  const safeLimit = Math.min(250, Math.max(1, Number(limit) || 100))
  const { data, error } = await state.supabase.rpc('get_staff_access_audit', {
    p_lodge_id: state.lodgeId,
    p_limit: safeLimit
  })
  if (error) throw new Error(error.message || 'Could not load the staff access audit.')
  return Array.isArray(data) ? data : []
}

/** @param {string} id @param {string} password */
export async function resetUserPassword(id, password) {
  await requireStaffAdmin();
  const users = /** @type {AuthUserExpectedView[]} */ (state.isOnline ? await getAllUsers() : readCache('users'));
  const existingUser = users.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  assertManagerCanManageRole(existingUser.role);
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

  const password_hash = bcrypt.hashSync(password, 10);

  if (state.isOnline) {
    const { data: rawResult, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('set_user_password', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_password_hash: password_hash
    });
    const result = /** @type {AuthRpcExpectedResultView|null} */ (rawResult);
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(/** @type {string} */ (result?.error || 'Could not reset password'));
    await refreshCache('users');
  } else {
  const cached = /** @type {AuthUserExpectedView[]} */ (readCache('users'));
    const idx = cached.findIndex((u) => u.id === id);
    if (idx < 0) throw new Error('Staff account not found in local data.');
    cached[idx] = { ...cached[idx], password_hash };
    writeCache('users', cached);
    await queueOperationBridge('rpc', 'set_user_password', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_password_hash: password_hash
    });
  }

  await ensureSupabaseAuthStaffUserReady(existingUser, password);

  upsertAuthEntry(existingUser.email.trim().toLowerCase(), bcrypt.hashSync(password, 10));
  logActivity('staff_password_reset', `${existingUser.name || existingUser.email} · desktop password updated`);
}

/** @param {StaffPinChangeInputExpectedView} [input] */
export async function changeOwnStaffPin({ current_pin, currentPin, new_pin, newPin } = {}) {
  // Self-service Staff PIN change for the signed-in operator (bartenders,
  // cashiers and everyone else). Admin/manager override via updateUser is
  // unchanged. Online-only: the authoritative check + hash live in the
  // change_own_staff_pin RPC so retries stay idempotent and audited via the
  // existing staff_approval_pin_changed trigger.
  const actorId = state.currentUser?.id || null;
  if (!actorId) throw new Error('Sign in again before changing your Staff PIN.');
  const newDigits = String(new_pin ?? newPin ?? '').trim();
  if (!/^[0-9]{4,6}$/.test(newDigits)) throw new Error('Staff PIN must be 4–6 digits.');
  const currentDigits = String(current_pin ?? currentPin ?? '').trim();

  const cachedUsers = /** @type {AuthUserExpectedView[]} */ (readCache('users')) || [];
  const cachedSelf = cachedUsers.find((entry) => entry?.id === actorId) || null;
  const hasPin = Boolean(cachedSelf?.pin_hash);
  if (hasPin && !currentDigits) {
    throw new Error('Enter your current Staff PIN to set a new one. If you forgot it, ask an admin to reset it in Staff Management.');
  }
  if (hasPin && currentDigits && currentDigits === newDigits) {
    throw new Error('The new PIN must be different from the current PIN.');
  }

  if (!state.isOnline || !state.supabase) {
    throw new Error('Connect to the internet to change your Staff PIN, then try again.');
  }
  if (!state.lodgeId) throw new Error('A business context is required to change your Staff PIN.');

  const { data: rawResult, error } = await state.supabase.rpc('change_own_staff_pin', {
    payload: {
      lodge_id: state.lodgeId,
      current_pin: currentDigits || null,
      new_pin: newDigits,
      device_id: `desktop-${String(state.lodgeId).slice(0, 8)}`
    }
  });
  const result = /** @type {AuthRpcExpectedResultView|null} */ (rawResult);
  if (error) {
    const message = String(error.message || '');
    if (/could not find the function|PGRST202|does not exist|schema cache/i.test(message)) {
      throw new Error('This app can change your PIN, but the database update is not deployed yet. Ask an admin to set it in Staff Management for now.');
    }
    throw new Error(message || 'Could not change your Staff PIN.');
  }
  if (!result?.success) throw new Error(/** @type {string} */ (result?.error || 'Could not change your Staff PIN.'));

  // Keep the trusted offline verifier working on this computer without
  // queueing a second write (the server already committed + audited).
  try {
    const newHash = bcrypt.hashSync(newDigits, 10);
    const cached = /** @type {AuthUserExpectedView[]} */ (readCache('users')) || [];
    const idx = cached.findIndex((entry) => entry?.id === actorId);
    if (idx >= 0) {
      cached[idx] = { ...cached[idx], pin_hash: newHash };
      writeCache('users', cached);
    }
    await refreshCache('users').catch(() => {});
    try {
      const after = /** @type {AuthUserExpectedView[]} */ (readCache('users')) || [];
      const nextIdx = after.findIndex((entry) => entry?.id === actorId);
      if (nextIdx >= 0 && !after[nextIdx]?.pin_hash) {
        after[nextIdx] = { ...after[nextIdx], pin_hash: newHash };
        writeCache('users', after);
      }
    } catch { /* keep the locally-hashed PIN when the server read omits it */ }
  } catch { /* cache update is best-effort; the server commit already succeeded */ }

  logActivity('staff_approval_pin_changed', `${state.currentUser?.name || state.currentUser?.email || 'Staff account'} · own Staff PIN updated`);
  return { success: true };
}

/** @param {string} [email] @returns {Promise<AuthStatusResultExpectedView>} */
export async function getAuthStatus(email = '') {
  await checkOnline();
  if (!state.lodgeId) {
    return {
      online: state.isOnline,
      lodge_id: null,
      hasOfflineAccess: false,
      hasTrustedSession: false,
      savedSessionCount: 0,
      hasCachedUsers: false,
      hasSavedAccounts: false,
      message: 'Choose a lodge on this computer for staff sign-in. Master admin sign-in still works.'
    };
  }
  const emailLower = normalizeEmail(email);
  const authEntries = /** @type {{lodge_id?: unknown, email?: unknown, password_hash?: unknown, deprecated?: unknown}[]} */ (readAuthCache()).filter((entry) => entry.lodge_id === state.lodgeId);
  const cachedUsers = /** @type {AuthUserExpectedView[]} */ (readCache('users')).
  map(normalizeUserRecord).
  filter((entry) => entry !== null && (!entry.lodge_id || entry.lodge_id === normalizeLodgeId(state.lodgeId)));
  const trustedSessions = pruneExpiredTrustedSessions().
  map(normalizeTrustedSessionRecord).
  filter((session) => session !== null && session !== undefined && (!session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId)));
  const legacySession = normalizeTrustedSessionRecord(readSessionNonce());
  const allTrustedSessions = [
  ...trustedSessions,
  ...(legacySession && (!legacySession.lodge_id || legacySession.lodge_id === normalizeLodgeId(state.lodgeId)) ? [legacySession] : [])];

  const hasTrustedSession = emailLower ?
  allTrustedSessions.some((session) => session.email === emailLower) :
  allTrustedSessions.length > 0;
  const hasOfflineAccess = emailLower ?
  authEntries.some((entry) => entry.email === emailLower) && cachedUsers.some((user) => user.email === emailLower) :
  authEntries.length > 0 && cachedUsers.length > 0;

  let message = 'Online. Staff can sign in normally.';
  if (!state.isOnline && hasTrustedSession) {
    message = 'Offline. Enter this user password to open the saved session on this computer.';
  } else if (!state.isOnline && emailLower && !hasOfflineAccess) {
    message = 'Offline. This account has no saved trusted session on this computer yet.';
  } else if (!state.isOnline) {
    message = allTrustedSessions.length > 0 ?
    'Offline. Choose a saved staff account and enter its password.' :
    'Offline. No saved staff sessions are available on this computer yet.';
  } else if (emailLower && !hasOfflineAccess) {
    message = 'Online. After this account signs in successfully once here, this computer can reopen its saved trusted session while offline.';
  } else if (emailLower && hasOfflineAccess) {
    message = 'Online. This account has local data on this computer. Offline access uses its saved session plus password.';
  } else if (hasOfflineAccess) {
    message = 'Online. This computer has saved local data for at least one staff account.';
  }

  return {
    online: state.isOnline,
    lodge_id: state.lodgeId,
    hasOfflineAccess,
    hasTrustedSession,
    savedSessionCount: allTrustedSessions.length,
    hasCachedUsers: cachedUsers.length > 0,
    hasSavedAccounts: authEntries.length > 0,
    message
  };
}

/** @param {string} id */
export async function deleteUser(id) {
  await requireStaffAdmin();
  const users = /** @type {AuthUserExpectedView[]} */ (state.isOnline ? await getAllUsers() : /** @type {AuthUserExpectedView[]} */ (readCache('users')).map(normalizeUserRecord).filter((user) => user !== null));
  const existingUser = users.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  await assertStarterUsersAccessLite({ data: { _delete: true }, existingUser });
  assertManagerCanManageRole(existingUser.role);
  if (state.currentUser?.id === id) throw new Error('You cannot delete the account you are currently signed in with.');

  if (isProtectedAdmin(existingUser) && countProtectedAdmins(users, id) === 0) {
    throw new Error('You cannot delete the last admin in this lodge.');
  }

  if (state.isOnline) {
    const { data: rawResult, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('delete_user', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    const result = /** @type {AuthRpcExpectedResultView|null} */ (rawResult);
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(/** @type {string} */ (result?.error || 'Could not delete user'));
    await refreshCache('users');
  } else {
    const cached = /** @type {AuthUserExpectedView[]} */ (readCache('users'));
    writeCache('users', cached.filter((u) => u.id !== id));
    await queueOperationBridge('rpc', 'delete_user', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
  }
  logActivity('staff_account_deleted', `${existingUser.name || existingUser.email} · archived account permanently deleted`);
}
