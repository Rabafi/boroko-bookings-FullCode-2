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

const AUTH_CONTRACT_VERSION = 2;
const ADMIN_GUARD_STATUSES = new Set(['active', 'suspended']);
const SUPABASE_AUTH_USER_PAGE_SIZE = 1000;
const MANAGER_MANAGED_ROLES = new Set(['cashier', 'supervisor', 'receptionist', 'operations']);

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
  return readCache('users')
    .map(normalizeUserRecord)
    .filter(Boolean)
    .some((user) => normalizeLodgeId(user.lodge_id) === lodgeId);
}

async function requireStaffAdmin({ allowInitialSetup = false } = {}) {
  if (currentUserCanAdministerStaff()) return;
  if (allowInitialSetup && !(await hasExistingLodgeUsers())) return;
  throw new Error('Only a manager or admin can manage staff accounts.');
}

function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  try {
    console.log(`[AUTH TRACE] ${label}`, payload);
  } catch {
    // Best-effort debug logging only.
  }
}

function queueOperationBridge(...args) {
  if (typeof state.queueOperation !== 'function') {
    throw new Error('Queue operation runtime is not available.');
  }
  return state.queueOperation(...args);
}

function nowIso() {
  return new Date().toISOString();
}

async function findSupabaseAuthUserByEmail(adminClient, emailLower) {
  if (!adminClient || !emailLower) return null;
  for (let page = 1; page <= 10; page += 1) {
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
  return null;
}

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
    const { data, error } = await adminClient.auth.admin.updateUserById(authUserId, {
      password,
      email_confirm: true,
      user_metadata: metadata
    });
    if (error) throw new Error(error.message || 'Could not update Supabase Auth password.');
    authUserId = data?.user?.id || authUserId;
  } else {
    const { data, error } = await adminClient.auth.admin.createUser({
      email: emailLower,
      password,
      email_confirm: true,
      user_metadata: metadata
    });
    if (error) throw new Error(error.message || 'Could not create confirmed Supabase Auth user.');
    authUserId = data?.user?.id || null;
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

function isProtectedAdmin(user) {
  return normalizeStaffRole(user?.role) === 'admin' && ADMIN_GUARD_STATUSES.has(normalizeStaffStatus(user?.status));
}

function countProtectedAdmins(users = [], excludingId = null) {
  return users.filter((user) => user?.id !== excludingId && isProtectedAdmin(user)).length;
}

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
  const health = {
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
  };

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
    health.code = isBackendAuthSchemaError(e.message || '') ? 'backend_auth_schema_outdated' : 'health_check_failed';
    health.error = isBackendAuthSchemaError(e.message || '') ?
    'The backend lodge auth context schema is outdated for this desktop auth flow. Run the checked-in auth migrations, then try again.' :
    e.message;
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
  const { rpcResult, contract } = await fetchAuthenticateUserContract(probeEmail);
  if (rpcResult?.error) {
    health.code = isBackendAuthSchemaError(rpcResult.error.message || '') ? 'backend_auth_schema_outdated' : 'health_check_failed';
    health.error = isBackendAuthSchemaError(rpcResult.error.message || '') ?
    'The canonical authenticate_user function is missing or outdated. Run the checked-in auth migrations, then try again.' :
    rpcResult.error.message;
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

export async function createUser(data) {
  await requireStaffAdmin({ allowInitialSetup: true });
  assertManagerCanManageRole(data?.role);
  if (currentUserIsLimitedStaffManager() && Object.keys(data?.capability_overrides || {}).length > 0) {
    throw new Error('Managers cannot set custom permission exceptions. Ask an administrator to make this access change.');
  }
  await assertCreationWithinUsageLimit('user', { forceRemoteRefresh: state.isOnline });
  const emailLower = data.email.trim().toLowerCase();
  if (state.isOnline) {
    const query = state.supabase.from('users').select('id').eq('email', emailLower).eq('lodge_id', state.lodgeId);
    const { data: existing } = await query.limit(1);
    if (existing && existing.length > 0) {
      throw new Error(`A user with the email "${emailLower}" already exists in this lodge.`);
    }
  } else {
    const cached = readCache('users');
    const duplicate = cached.some((u) => u.email?.toLowerCase() === emailLower && u.lodge_id === state.lodgeId);
    if (duplicate) {
      throw new Error(`A user with the email "${emailLower}" already exists in this lodge.`);
    }
  }

  const hash = bcrypt.hashSync(data.password, 10);
  const pwaAccess = resolvePwaAccessUpdate({}, data);
  const id = randomUUID();
  const user = {
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
    pwa_enabled: pwaAccess.enabled === true,
    pwa_password_hash: pwaAccess.password_hash,
    pwa_password_set_at: pwaAccess.password_hash ? new Date().toISOString() : null,
    pwa_password_reset_by: pwaAccess.password_hash ? state.currentUser?.id || null : null,
    pwa_disabled_reason: pwaAccess.enabled === true ? null : pwaAccess.requested ? pwaAccess.disabled_reason : null,
    allowed_outlet_ids: Array.isArray(data.allowed_outlet_ids) ? data.allowed_outlet_ids : [],
    capability_overrides: normalizeCapabilityOverrides(data.capability_overrides)
  };
  if (data.pin) {
    user.pin_hash = bcrypt.hashSync(String(data.pin).trim(), 10);
  }

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_user', { payload: user });
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
        result?.error || 'Supabase did not return the new staff account after insert.',
        { email: emailLower, lodge_id: state.lodgeId }
      );
    }
    try {
      if (state.adminDb) {
        await ensureSupabaseAuthStaffUserReady(
          { ...user, id: result.id, auth_user_id: null },
          data.password
        );
      } else {
        await createSupabaseAuthUserForStaff(emailLower, data.password);
      }
    } catch (authError) {
      console.error('[AUTH] Staff profile was created but Supabase Auth preparation failed:', {
        email: emailLower,
        lodge_id: state.lodgeId,
        user_id: result.id,
        message: authError?.message || 'unknown_error'
      });
    }
    if (pwaAccess.requested) {
      const { data: pwaResult, error: pwaError } = await state.supabase.rpc('set_user_pwa_access', {
        p_id: result.id,
        p_lodge_id: state.lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: state.currentUser?.id || null
      });
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
          pwaResult?.error || 'Could not prepare manager mobile app access.',
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

  const cached = readCache('users');
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

function assertManagerCanManageRole(role) {
  if (currentUserIsLimitedStaffManager() && !MANAGER_MANAGED_ROLES.has(normalizeStaffRole(role))) {
    throw new Error('Managers can manage service-team accounts only. An administrator must assign finance, manager, or owner access.');
  }
}

export async function updateUser(id, data) {
  await requireStaffAdmin();
  const cachedUsers = readCache('users');
  const existingUser = cachedUsers.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  assertManagerCanManageRole(existingUser.role);
  assertManagerCanManageRole(data?.role || existingUser.role);
  if (currentUserIsLimitedStaffManager() && Object.prototype.hasOwnProperty.call(data || {}, 'capability_overrides')) {
    const requestedOverrides = normalizeCapabilityOverrides(data.capability_overrides);
    const currentOverrides = normalizeCapabilityOverrides(existingUser.capability_overrides);
    if (JSON.stringify(requestedOverrides) !== JSON.stringify(currentOverrides)) {
      throw new Error('Managers cannot set custom permission exceptions. Ask an administrator to make this access change.');
    }
  }
  const update = {};
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
  const pwaAccess = resolvePwaAccessUpdate(existingUser, buildPwaAccessInput(data));
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
      const { data: result, error } = await state.supabase.rpc('update_user_profile', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        payload: update
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not update user');
    }
    if (password_hash) {
      const { data: passwordResult, error: passwordError } = await state.supabase.rpc('set_user_password', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_password_hash: password_hash
      });
      if (passwordError) throw new Error(passwordError.message);
      if (!passwordResult?.success) throw new Error(passwordResult?.error || 'Could not update user password');
      await ensureSupabaseAuthStaffUserReady({ ...existingUser, id, ...update }, data.password);
    }
    if (pwaAccess.requested) {
      const { data: pwaResult, error: pwaError } = await state.supabase.rpc('set_user_pwa_access', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: state.currentUser?.id || null
      });
      if (pwaError) throw new Error(pwaError.message);
      if (!pwaResult?.success) throw new Error(pwaResult?.error || 'Could not update manager mobile app access');
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

export async function getStaffAccessAudit(limit = 100) {
  await requireStaffAdmin()
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

export async function resetUserPassword(id, password) {
  await requireStaffAdmin();
  const users = state.isOnline ? await getAllUsers() : readCache('users');
  const existingUser = users.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  assertManagerCanManageRole(existingUser.role);
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

  const password_hash = bcrypt.hashSync(password, 10);

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('set_user_password', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_password_hash: password_hash
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not reset password');
    await refreshCache('users');
  } else {
    const cached = readCache('users');
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
  const authEntries = readAuthCache().filter((entry) => entry.lodge_id === state.lodgeId);
  const cachedUsers = readCache('users').
  map(normalizeUserRecord).
  filter((entry) => entry && (!entry.lodge_id || entry.lodge_id === normalizeLodgeId(state.lodgeId)));
  const trustedSessions = pruneExpiredTrustedSessions().
  map(normalizeTrustedSessionRecord).
  filter((session) => session && (!session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId)));
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

export async function deleteUser(id) {
  await requireStaffAdmin();
  const users = state.isOnline ? await getAllUsers() : readCache('users').map(normalizeUserRecord).filter(Boolean);
  const existingUser = users.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  assertManagerCanManageRole(existingUser.role);
  if (state.currentUser?.id === id) throw new Error('You cannot delete the account you are currently signed in with.');

  if (isProtectedAdmin(existingUser) && countProtectedAdmins(users, id) === 0) {
    throw new Error('You cannot delete the last admin in this lodge.');
  }

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_user', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete user');
    await refreshCache('users');
  } else {
    const cached = readCache('users');
    writeCache('users', cached.filter((u) => u.id !== id));
    await queueOperationBridge('rpc', 'delete_user', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
  }
  logActivity('staff_account_deleted', `${existingUser.name || existingUser.email} · archived account permanently deleted`);
}
