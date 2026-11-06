import bcrypt from 'bcryptjs';
import { state } from '../state.js';
import { readAuthCache, upsertCachedUser, writeAuthCache } from './authCache.js';
import {
  applyBackendSession,
  buildSupabaseAuthClient,
  buildSupabaseClient,
  clearBackendSession
} from './authClients.js';
import { readCache } from './cacheStore.js';
import { refreshAllCaches } from './cacheRefresh.js';
import { checkOnline } from './connectivity.js';
import { restoreSavedTrustedSession } from './authSession.js';
import { touchUserPresence } from './users.js';
import { ensureReadyProfileForLodge } from './profiles.js';
import {
  isBackendAuthSchemaError,
  normalizeEmail,
  normalizeLodgeId,
  normalizeUserRecord
} from './shared.js';
import { normalizeStaffStatus } from '../../shared/accessControl.js';
import {
  createProductMismatchError,
  getProductDefinition,
  getRuntimeProductId,
  isProductCompatiblePropertyType
} from '../../shared/productIdentity.js';

/** RPC rows remain untrusted; the view documents existing field reads only. */
/** @typedef {{email?: unknown, lodge_id?: unknown}} AuthCacheEntryExpectedDataView */
/** @typedef {{found?: unknown, authenticated?: unknown, id?: unknown, email?: unknown, role?: unknown, status?: unknown, lodge_id?: unknown, name?: unknown, password_hash?: unknown, last_sign_in_at?: unknown, last_desktop_sign_in_at?: unknown, last_pwa_sign_in_at?: unknown, last_activity_at?: unknown, invite_sent_at?: unknown, password_updated_at?: unknown, capability_overrides?: unknown, session_token?: unknown, session_expires_at?: unknown}} AuthContractRowExpectedDataView */
/** Normalized only by the existing contract normalizer; unknown leaves are not validated. */
/** @typedef {{found: boolean, authenticated: boolean, id: unknown, email: string, role: unknown, status: string, lodge_id: string | null, name: unknown, password_hash: unknown, last_sign_in_at: unknown, last_desktop_sign_in_at: unknown, last_pwa_sign_in_at: unknown, last_activity_at: unknown, invite_sent_at: unknown, password_updated_at: unknown, capability_overrides: unknown, session_token: unknown, session_expires_at: unknown}} NormalizedAuthContractRowExpectedDataView */
/** @typedef {{ok: true, row: NormalizedAuthContractRowExpectedDataView} | {ok: false, reason: unknown}} AuthContractNormalizationResult */
/** Leaves come from auth RPC/cache records; this is a read view, not validation. */
/** @typedef {Record<string, unknown> & {id?: unknown, lodge_id?: unknown, name?: unknown, allowed_outlet_ids?: unknown}} AuthUserExpectedDataView */
/** @typedef {{user: AuthUserExpectedDataView, source: string, session_token: unknown, session_expires_at: unknown, mode?: 'online', code?: never, error?: never, details?: never, memberships?: never}} AuthLoginOnlineSuccess */
/** @typedef {{user: null, code: unknown, error: unknown, details?: unknown, memberships?: unknown, source?: never, session_token?: never, session_expires_at?: never}} AuthLoginFailure */
/** @typedef {AuthLoginOnlineSuccess | AuthLoginFailure} AuthOnlineResult */
/** @typedef {AuthOnlineResult | {user: AuthUserExpectedDataView, mode: 'offline_trusted_session', warning: string}} AuthLoginResult */
/** Read view for native Error-like thrown values; no validation or normalization. */
/** @typedef {{message?: unknown, code?: unknown, details?: unknown, hint?: unknown, stack?: unknown}} AuthCaughtErrorReadView */
/** `list_desktop_product_memberships` returns lodge_id as a non-null SQL uuid, serialized as text; RPC JSON remains unvalidated. */
/** @typedef {{lodge_id: string}} AuthMembershipExpectedDataView */
/** Cached settings are read through the existing cache fallback and are not validated here. */
/** @typedef {{property_type?: unknown, business_type?: unknown}} AuthSettingsExpectedDataView */

// Bundler configuration is passed through unchanged; the Supabase client owns
// its existing missing-key failure behavior.
const SUPABASE_ANON_KEY = /** @type {string} */ (import.meta.env.VITE_SUPABASE_KEY);

/** @param {string} label @param {Record<string, unknown>} [payload] */
function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  try {
    console.log(`[AUTH TRACE] ${label}`, payload);
  } catch {
    // Best-effort debug logging only.
  }
}

/** @param {string} clientLabel @param {unknown} [sessionToken] @param {string | null} [email] */
export function getAuthClientState(clientLabel, sessionToken = null, email = null) {
  return {
    clientLabel,
    lodge_id: state.lodgeId,
    email,
    current_session_token_present: !!state.backendSession?.token,
    current_session_token_length: state.backendSession?.token ? /** @type {{length?: unknown}} */ (state.backendSession.token).length : null,
    explicit_session_token_present: !!sessionToken,
    explicit_session_token_length: sessionToken ? /** @type {{length?: unknown}} */ (sessionToken).length : null
  };
}

/** @param {unknown} row @returns {AuthContractNormalizationResult} */
export function normalizeAuthContractRow(row) {
  if (!row || typeof row !== 'object') {
    return { ok: false, reason: 'authenticate_user returned no result.' };
  }
  const expectedRow = /** @type {AuthContractRowExpectedDataView} */ (row);
  const normalized = {
    found: typeof expectedRow.found === 'boolean' ? expectedRow.found : Boolean(expectedRow.id || expectedRow.email),
    authenticated: typeof expectedRow.authenticated === 'boolean' ? expectedRow.authenticated : false,
    id: expectedRow.id || null,
    email: normalizeEmail(expectedRow.email),
    role: expectedRow.role || null,
    status: normalizeStaffStatus(expectedRow.status),
    lodge_id: normalizeLodgeId(expectedRow.lodge_id),
    name: expectedRow.name || '',
    password_hash: expectedRow.password_hash || null,
    last_sign_in_at: expectedRow.last_sign_in_at || null,
    last_desktop_sign_in_at: expectedRow.last_desktop_sign_in_at || null,
    last_pwa_sign_in_at: expectedRow.last_pwa_sign_in_at || null,
    last_activity_at: expectedRow.last_activity_at || null,
    invite_sent_at: expectedRow.invite_sent_at || null,
    password_updated_at: expectedRow.password_updated_at || null,
    capability_overrides:
      expectedRow.capability_overrides && typeof expectedRow.capability_overrides === 'object' && !Array.isArray(expectedRow.capability_overrides)
        ? expectedRow.capability_overrides
        : {},
    session_token: expectedRow.session_token || null,
    session_expires_at: expectedRow.session_expires_at || null
  };

  const missingCoreFields =
  !normalized.lodge_id ||
  !Object.prototype.hasOwnProperty.call(expectedRow, 'found') ||
  !Object.prototype.hasOwnProperty.call(expectedRow, 'authenticated');

  if (missingCoreFields) {
    return {
      ok: false,
      reason: 'authenticate_user returned an outdated contract. Expected found/authenticated/lodge_id fields.'
    };
  }

  if (normalized.found && (!normalized.id || !normalized.email || !normalized.role)) {
    return {
      ok: false,
      reason: 'authenticate_user returned an incomplete user record.'
    };
  }

  return { ok: true, row: normalized };
}

/** @param {string} email */
export function removeAuthEntry(email) {
  const emailLower = normalizeEmail(email);
  const filtered = readAuthCache().filter((/** @type {AuthCacheEntryExpectedDataView} */ e) => !(e.email === emailLower && e.lodge_id === state.lodgeId));
  writeAuthCache(filtered);
}

/** @param {string} email @param {string} passwordHash */
export function upsertAuthEntry(email, passwordHash) {
  const emailLower = normalizeEmail(email);
  const entries = readAuthCache().filter((/** @type {AuthCacheEntryExpectedDataView} */ e) => !(e.email === emailLower && e.lodge_id === state.lodgeId));
  entries.push({ email: emailLower, lodge_id: state.lodgeId, password_hash: passwordHash, deprecated: true });
  writeAuthCache(entries);
}

/** @param {AuthUserExpectedDataView} user @param {string} emailLower @param {string | null} [password] */
async function cacheSuccessfulLogin(user, emailLower, password = null) {
  console.log('[AUTH] cache write start:', { email: emailLower, userId: user?.id, lodge_id: state.lodgeId });
  if (typeof password === 'string' && password) {
    const localHash = await bcrypt.hash(password, 10);
    upsertAuthEntry(emailLower, localHash);
  }
  upsertCachedUser(user);
  const authEntries = readAuthCache().filter((/** @type {AuthCacheEntryExpectedDataView} */ entry) => entry.email === emailLower && entry.lodge_id === state.lodgeId);
  const cachedUser = getCachedUser(emailLower);
  console.log('[AUTH] cache write result:', {
    email: emailLower,
    auth_entry_written: authEntries.length > 0,
    cached_user_written: !!cachedUser,
    cached_user_id: cachedUser?.id || null
  });
}

/** @param {string} emailLower */
export function getCachedUser(emailLower) {
  const normalizedEmail = normalizeEmail(emailLower);
  // Persisted cache contents are unvalidated; keep the existing .map failure behavior.
  return /** @type {AuthUserExpectedDataView[]} */ (readCache('users')).
  map(normalizeUserRecord).
  find((/** @type {AuthUserExpectedDataView | null | undefined} */ u) => u?.email === normalizedEmail && (u.lodge_id ? u.lodge_id === state.lodgeId : true));
}

/** @param {unknown} reason @param {{email?: unknown} & Record<string, unknown>} [details] */
function logAuthFailure(reason, details = {}) {
  console.warn('[AUTH] login failed:', {
    reason,
    lodge_id: state.lodgeId,
    email: details.email,
    online: state.isOnline,
    ...details
  });
}

/** @param {Record<string, unknown>} user @returns {AuthUserExpectedDataView} */
export function toSafeUser(user) {
  const {
    password_hash: _ph,
    session_token: _st,
    session_expires_at: _se,
    ...safeUser
  } = user;
  return safeUser;
}

/** @param {{status?: unknown} | null | undefined} user */
function isStaffAccountActive(user) {
  return normalizeStaffStatus(user?.status) === 'active';
}

/** @param {string} emailLower */
export async function fetchAuthenticateUserContract(emailLower) {
  try {
    const authClient = buildSupabaseClient(SUPABASE_ANON_KEY);
    authTrace('auth client state', getAuthClientState('anon-health-probe', null, emailLower));
    const rpcArgs = {
      p_email: emailLower,
      p_lodge_id: state.lodgeId,
      p_password: null,
      p_session_type: 'desktop'
    };
    authTrace('rpc call start', {
      functionName: 'authenticate_user',
      ...getAuthClientState('anon-health-probe', null, emailLower),
      args: rpcArgs
    });
    const rpcResult = await authClient.rpc('authenticate_user', rpcArgs);
    if (rpcResult.error) {
      authTrace('rpc call error', {
        functionName: 'authenticate_user',
        ...getAuthClientState('anon-health-probe', null, emailLower),
        args: rpcArgs,
        error: rpcResult.error
      });
    }
    const rpcRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
    return { rpcResult, rpcRow, contract: normalizeAuthContractRow(rpcRow) };
  } catch (error) {
    const caught = /** @type {AuthCaughtErrorReadView} */ (error);
    authTrace('rpc call error', {
      functionName: 'authenticate_user',
      ...getAuthClientState('anon-health-probe', null, emailLower),
      args: {
        p_email: emailLower,
        p_lodge_id: state.lodgeId,
        p_password: null,
        p_session_type: 'desktop'
      },
      error: {
        message: caught.message || 'authenticate_user failed.',
        code: caught.code || null,
        details: caught.details || null,
        hint: caught.hint || null,
        stack: caught.stack || null
      }
    });
    return {
      rpcResult: { error: { message: caught.message || 'authenticate_user failed.' } },
      rpcRow: null,
      contract: { ok: false, reason: caught.message || 'authenticate_user failed.' }
    };
  }
}

/** @param {string | null} [targetLodgeId] */
export async function getLodgeAuthContext(targetLodgeId = state.lodgeId) {
  const authClient = buildSupabaseClient(SUPABASE_ANON_KEY);
  const rpcArgs = {
    p_lodge_id: targetLodgeId
  };
  authTrace('auth client state', getAuthClientState('anon-lodge-context'));
  authTrace('rpc call start', {
    functionName: 'get_lodge_auth_context',
    ...getAuthClientState('anon-lodge-context'),
    args: rpcArgs
  });
  const { data, error } = await authClient.rpc('get_lodge_auth_context', rpcArgs);
  if (error) {
    authTrace('rpc call error', {
      functionName: 'get_lodge_auth_context',
      ...getAuthClientState('anon-lodge-context'),
      args: rpcArgs,
      error
    });
  }
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

/** @param {string} lodgeId */
async function assertAuthenticatedLodgeMatchesCurrentProduct(lodgeId) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).
  from('settings').
  select('property_type, business_type').
  eq('lodge_id', lodgeId).
  maybeSingle();

  if (error) throw error;
  const propertyType = data?.property_type || data?.business_type || 'lodge';
  const productId = getRuntimeProductId();
  if (isProductCompatiblePropertyType(productId, propertyType)) return;
  throw createProductMismatchError(productId, propertyType);
}

/**
 * Offline / trusted-session path: reject sessions whose cached property type
 * belongs to a different product binary.
 */
/** @param {AuthUserExpectedDataView | null | undefined} user */
function assertOfflineSessionMatchesCurrentProduct(user) {
  if (!user || user.isMasterAdmin) return;
  const settings = (/** @type {AuthSettingsExpectedDataView[] | null | undefined} */ (readCache('settings')))?.[0] || null;
  if (!settings) return;
  const propertyType = settings.property_type || settings.business_type;
  if (!propertyType) return;
  const productId = getRuntimeProductId();
  if (isProductCompatiblePropertyType(productId, propertyType)) return;
  throw createProductMismatchError(productId, propertyType);
}

/** @param {string} emailLower */
async function findRemoteUsersByEmailForCurrentLodge(emailLower) {
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).
    from('users').
    select('id, email, role, lodge_id, created_at, name').
    eq('email', emailLower).
    eq('lodge_id', state.lodgeId).
    limit(5);
    if (error) return [];
    return (data || []).map(normalizeUserRecord).filter(Boolean);
  } catch {
    return [];
  }
}

/** @param {string} emailLower @param {string} password @param {string | null} [selectedLodgeId] @returns {Promise<AuthOnlineResult>} */
async function authenticateOnline(emailLower, password, selectedLodgeId = null) {
  if (!state.lodgeId) {
    return authenticateWithSupabaseAuth(emailLower, password, selectedLodgeId);
  }

  const supabaseAuth = await authenticateWithSupabaseAuth(emailLower, password, selectedLodgeId);
  if (
    supabaseAuth.user ||
    !/** @type {unknown[]} */ (['supabase_auth_unavailable', 'supabase_auth_not_migrated']).includes(supabaseAuth.code)
  ) {
    return supabaseAuth;
  }

  /** @type {{error: {message?: unknown} | null}} */
  let rpcResult;
  /** @type {unknown} */
  let rpcRow;
  /** @type {AuthContractNormalizationResult} */
  let contract;
  try {
    const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Authentication timed out — server did not respond in time.')), 15000)
    );
    const authResult = await Promise.race([
    (async () => {
      try {
        const authClient = buildSupabaseClient(SUPABASE_ANON_KEY);
        const rpcArgs = {
          p_email: emailLower,
          p_lodge_id: state.lodgeId,
          p_password: password,
          p_session_type: 'desktop'
        };
        authTrace('auth client state', getAuthClientState('anon-login', null, emailLower));
        authTrace('rpc call start', {
          functionName: 'authenticate_user',
          ...getAuthClientState('anon-login', null, emailLower),
          args: {
            ...rpcArgs,
            p_password: typeof password === 'string' ? `[length:${password.length}]` : null
          }
        });
        const rpcResult = await authClient.rpc('authenticate_user', rpcArgs);
        if (rpcResult.error) {
          authTrace('rpc call error', {
            functionName: 'authenticate_user',
            ...getAuthClientState('anon-login', null, emailLower),
            args: {
              ...rpcArgs,
              p_password: typeof password === 'string' ? `[length:${password.length}]` : null
            },
            error: rpcResult.error
          });
        }
        const rpcRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
        return { rpcResult, rpcRow, contract: normalizeAuthContractRow(rpcRow) };
      } catch (error) {
        const caught = /** @type {AuthCaughtErrorReadView} */ (error);
        authTrace('rpc call error', {
          functionName: 'authenticate_user',
          ...getAuthClientState('anon-login', null, emailLower),
          args: {
            p_email: emailLower,
            p_lodge_id: state.lodgeId,
            p_password: typeof password === 'string' ? `[length:${password.length}]` : null,
            p_session_type: 'desktop'
          },
          error: {
            message: caught.message || 'authenticate_user failed.',
            code: caught.code || null,
            details: caught.details || null,
            hint: caught.hint || null,
            stack: caught.stack || null
          }
        });
        return {
          rpcResult: { error: { message: caught.message || 'authenticate_user failed.' } },
          rpcRow: null,
          contract: { ok: false, reason: caught.message || 'authenticate_user failed.' }
        };
      }
    })(),
    timeoutPromise]
    );
    rpcResult = authResult.rpcResult;
    rpcRow = authResult.rpcRow;
    contract = authResult.contract;
  } catch (e) {
    return { user: null, code: 'server_unreachable', error: (/** @type {AuthCaughtErrorReadView} */ (e)).message };
  }

  // The normalizer returns exactly one own-property branch; keep trace output
  // equivalent to the former optional reads while respecting that union.
  const contractReasonForTrace = contract.ok ? null : contract.reason || null;
  const contractRowForTrace = contract.ok ? contract.row : null;

  console.log('[AUTH] online auth result:', {
    email: emailLower,
    lodge_id: state.lodgeId,
    rpc_error: rpcResult.error?.message || null,
    contract_ok: contract.ok,
    contract_reason: contractReasonForTrace,
    found: contractRowForTrace?.found ?? null,
    user_id: contractRowForTrace?.id || null
  });
  authTrace('db.loginUser online auth result', {
    email: emailLower,
    lodge_id: state.lodgeId,
    rpc_error: rpcResult.error?.message || null,
    contract_ok: contract.ok,
    contract_reason: contractReasonForTrace,
    found: contractRowForTrace?.found ?? null,
    authenticated: contractRowForTrace?.authenticated ?? null,
    user_id: contractRowForTrace?.id || null
  });

  if (rpcResult.error) {
    const errorMessage = /** @type {string} */ (rpcResult.error.message) || 'authenticate_user failed.';
    console.error('[AUTH] online verification error:', {
      email: emailLower,
      lodge_id: state.lodgeId,
      rpcError: errorMessage
    });
    if (isBackendAuthSchemaError(errorMessage)) {
      console.warn('[AUTH TRACE] schema error wrapper hit', {
        source: 'authenticate_user_rpc_error',
        email: emailLower,
        rpc_error: errorMessage
      });
    }
    return {
      user: null,
      code: 'auth_failed_real',
      error: errorMessage,
      details: {
        source: 'authenticate_user',
        rpc_error: errorMessage
      }
    };
  }

  if (!contract.ok) {
    console.error('[AUTH] online auth invalid RPC response shape:', {
      email: emailLower,
      lodge_id: state.lodgeId,
      reason: contract.reason,
      payload: rpcRow || null
    });
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'authenticate_user_contract_invalid',
      email: emailLower,
      reason: contract.reason,
      payload: rpcRow || null
    });
    return {
      user: null,
      code: 'auth_failed_real',
      error: contract.reason || 'Invalid authenticate_user contract response.',
      details: {
        source: 'authenticate_user_contract',
        reason: contract.reason,
        payload: rpcRow || null
      }
    };
  }

  const row = contract.row;
  if (normalizeLodgeId(row.lodge_id) !== normalizeLodgeId(state.lodgeId)) {
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'authenticate_user_lodge_mismatch',
      email: emailLower,
      returned_lodge_id: row.lodge_id,
      expected_lodge_id: state.lodgeId
    });
    return {
      user: null,
      code: 'auth_failed_real',
      error: 'authenticate_user returned a lodge_id that does not match this device.',
      details: {
        source: 'authenticate_user_lodge_mismatch',
        returned_lodge_id: row.lodge_id,
        expected_lodge_id: state.lodgeId
      }
    };
  }

  if (row.authenticated && row.found) {
    return {
      user: toSafeUser(row),
      source: 'rpc',
      session_token: row.session_token,
      session_expires_at: row.session_expires_at
    };
  }

  if (row.found) {
    return {
      user: null,
      code: 'wrong_password',
      error: 'That password is incorrect. Please try again or ask a manager to reset it.'
    };
  }

  const cachedUser = getCachedUser(emailLower);
  if (cachedUser) {
    return {
      user: null,
      code: 'wrong_lodge',
      error:
      'This account exists in saved data on this computer, but the server did not return it for the current lodge setup. Please ask support to check this device registration.'
    };
  }
  return {
    user: null,
    code: 'account_not_found',
    error: 'No staff account with that email was found for this lodge.'
  };
}

/** @param {string} emailLower @param {string} password @returns {Promise<AuthOnlineResult>} */
async function authenticateOnlineForDeviceBootstrap(emailLower, password) {
  if (!password) {
    return { user: null, code: 'wrong_password', error: 'Enter your password to sign in.' };
  }

  try {
    const authClient = buildSupabaseClient(SUPABASE_ANON_KEY);
    const { data, error } = await authClient.rpc('authenticate_user_for_device', {
      p_email: emailLower,
      p_password: password,
      p_session_type: 'desktop'
    });
    const row = Array.isArray(data) ? data[0] : data;

    if (error) {
      const message = error.message || 'authenticate_user_for_device failed.';
      if (/could not find the function|schema cache|authenticate_user_for_device/i.test(message)) {
        return {
          user: null,
          code: 'device_bootstrap_unavailable',
          error: 'This database does not support first sign-in on a new computer yet. Run the latest Supabase migrations, then try again.'
        };
      }
      return {
        user: null,
        code: 'auth_failed_real',
        error: message,
        details: { source: 'authenticate_user_for_device' }
      };
    }

    if (row?.reason === 'ambiguous_lodge') {
      return {
        user: null,
        code: 'ambiguous_lodge',
        error: 'This email is linked to more than one lodge. Sign in through Command Central or choose the lodge profile first.'
      };
    }

    if (row?.reason === 'not_found_or_wrong_password' || row?.reason === 'missing_credentials' || row?.found === false) {
      return {
        user: null,
        code: row?.reason === 'missing_credentials' ? 'wrong_password' : 'account_not_found',
        error: row?.reason === 'missing_credentials'
          ? 'Enter your email and password to sign in.'
          : 'No active staff account matched that email and password.'
      };
    }

    const contract = normalizeAuthContractRow(row);

    if (!contract.ok) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: contract.reason || 'Invalid authenticate_user_for_device contract response.',
        details: { source: 'authenticate_user_for_device', payload: row || null }
      };
    }

    if (!contract.row.authenticated || !contract.row.session_token) {
      return {
        user: null,
        code: 'wrong_password',
        error: 'That password is incorrect. Please try again or ask a manager to reset it.'
      };
    }

    return {
      user: toSafeUser(contract.row),
      source: 'device_bootstrap',
      session_token: contract.row.session_token,
      session_expires_at: contract.row.session_expires_at
    };
  } catch (error) {
    const caught = /** @type {AuthCaughtErrorReadView | null | undefined} */ (error);
    return {
      user: null,
      code: 'server_unreachable',
      error: caught?.message || 'The server could not verify this sign-in.'
    };
  }
}

/** @param {string} emailLower @param {string} password @param {string | null} [selectedLodgeId] @returns {Promise<AuthOnlineResult>} */
async function authenticateWithSupabaseAuth(emailLower, password, selectedLodgeId = null) {
  if (!password) {
    return { user: null, code: 'wrong_password', error: 'Enter your password to sign in.' };
  }

  try {
    const authClient = buildSupabaseAuthClient();
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: emailLower,
      password
    });

    if (authError) {
      const message = authError.message || 'Supabase Auth could not verify this sign-in.';
      if (/invalid login credentials|invalid credentials/i.test(message)) {
        return {
          user: null,
          code: 'supabase_auth_not_migrated',
          error: 'This account is not available in Supabase Auth yet.'
        };
      }
      return {
        user: null,
        code: 'auth_failed_real',
        error: message,
        details: { source: 'supabase_auth' }
      };
    }

    const accessToken = authData?.session?.access_token;
    if (!accessToken) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: 'Supabase Auth did not return an access token.',
        details: { source: 'supabase_auth' }
      };
    }

    const { data: membershipRows, error: membershipError } = await authClient.rpc('list_desktop_product_memberships', {
      p_product_id: getRuntimeProductId()
    });
    if (membershipError) {
      return {
        user: null,
        code: 'multi_company_login_unavailable',
        error: 'This database needs the latest multi-company sign-in update before this account can be used.'
      };
    }

    // The array shape is guarded, but its RPC-supplied row contents are not validated.
    const memberships = Array.isArray(membershipRows) ? /** @type {AuthMembershipExpectedDataView[]} */ (membershipRows) : [];
    // A cached profile is only a local convenience, not the user's company
    // selection. Restaurant and bar companies share this product, so silently
    // preferring the last one would make an email with both memberships open
    // the wrong business and bypass the chooser.
    const requestedLodgeId = normalizeLodgeId(selectedLodgeId);
    if (requestedLodgeId && !memberships.some((membership) => normalizeLodgeId(membership.lodge_id) === requestedLodgeId)) {
      return {
        user: null,
        code: 'invalid_company_selection',
        error: 'That company is not available for this account in this Tsa Bonno app.',
        memberships
      };
    }
    if (!requestedLodgeId && memberships.length > 1) {
      return {
        user: null,
        code: 'company_selection_required',
        error: 'This email belongs to more than one restaurant/bar company. Choose which one to open.',
        memberships
      };
    }
    if (!requestedLodgeId && memberships.length === 0) {
      const product = getProductDefinition(getRuntimeProductId());
      return { user: null, code: 'account_not_found', error: `This account is not assigned to a ${product.name} company.` };
    }

    const targetLodgeId = requestedLodgeId || normalizeLodgeId(/** @type {string} */ (memberships[0]?.lodge_id));
    const { data, error } = await authClient.rpc('authenticate_user_from_supabase', {
      p_lodge_id: targetLodgeId,
      p_session_type: 'desktop'
    });
    if (error) {
      if (/could not find the function|schema cache|authenticate_user_from_supabase/i.test(error.message || '')) {
        return {
          user: null,
          code: 'supabase_auth_unavailable',
          error: error.message
        };
      }
      return {
        user: null,
        code: 'auth_failed_real',
        error: error.message || 'Could not link this Supabase Auth user to the current lodge.',
        details: { source: 'authenticate_user_from_supabase' }
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    const contract = normalizeAuthContractRow(row);
    if (!contract.ok) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: contract.reason || 'Invalid Supabase Auth contract response.',
        details: { source: 'authenticate_user_from_supabase', payload: row || null }
      };
    }

    const normalized = contract.row;
    if (!normalized.found) {
      return {
        user: null,
        code: 'account_not_found',
        error: 'Supabase Auth verified the password, but this account is not linked to the selected lodge yet.'
      };
    }
    if (!isStaffAccountActive(normalized)) {
      return {
        user: null,
        code: 'account_inactive',
        error: normalized.status === 'archived'
          ? 'This staff account has been archived. Ask an admin to restore it before signing in.'
          : 'This staff account is suspended. Ask an admin to reactivate it before signing in.'
      };
    }

    if (!normalized.authenticated || !normalized.session_token) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: 'The server did not issue a valid Tsa Bonno session for this Supabase Auth user.',
        details: { source: 'authenticate_user_from_supabase' }
      };
    }

    return {
      user: toSafeUser(normalized),
      source: 'supabase_auth',
      session_token: normalized.session_token,
      session_expires_at: normalized.session_expires_at
    };
  } catch (error) {
    const caught = /** @type {AuthCaughtErrorReadView | null | undefined} */ (error);
    return {
      user: null,
      code: 'supabase_auth_unavailable',
      error: caught?.message || 'Supabase Auth could not be reached.'
    };
  }
}

/** @param {string} emailLower @param {string} password */
export async function createSupabaseAuthUserForStaff(emailLower, password) {
  if (!emailLower || !password) return null;
  const metadata = {
    lodge_id: state.lodgeId,
    app: 'boroko-bookings'
  };

  if (state.adminDb) {
    try {
      const { data, error } = await state.adminDb.auth.admin.createUser({
        email: emailLower,
        password,
        email_confirm: true,
        user_metadata: metadata
      });
      if (error) {
        console.warn('[AUTH] Supabase Auth admin staff create skipped:', {
          email: emailLower,
          message: error.message
        });
      } else {
        return data?.user?.id || null;
      }
    } catch (error) {
      const caught = /** @type {AuthCaughtErrorReadView | null | undefined} */ (error);
      console.warn('[AUTH] Supabase Auth admin staff create failed:', {
        email: emailLower,
        message: caught?.message || 'unknown_error'
      });
    }
  }

  try {
    const authClient = buildSupabaseAuthClient();
    const { data, error } = await authClient.auth.signUp({
      email: emailLower,
      password,
      options: { data: metadata }
    });
    if (error) {
      console.warn('[AUTH] Supabase Auth staff signup skipped:', {
        email: emailLower,
        message: error.message
      });
      return null;
    }
    return data?.user?.id || null;
  } catch (error) {
    const caught = /** @type {AuthCaughtErrorReadView | null | undefined} */ (error);
    console.warn('[AUTH] Supabase Auth staff signup failed:', {
      email: emailLower,
      message: caught?.message || 'unknown_error'
    });
    return null;
  }
}

/** @param {string} email @param {string} password @param {string | null} [selectedLodgeId] @returns {Promise<AuthLoginResult>} */
export async function loginUser(email, password, selectedLodgeId = null) {
  authTrace('db.loginUser start', {
    email,
    normalizedEmail: normalizeEmail(email),
    lodge_id: state.lodgeId,
    passwordLength: typeof password === 'string' ? password.length : null,
    hasPassword: typeof password === 'string' ? password.length > 0 : false
  });
  console.log('\n[DB LOGIN ATTEMPT]');
  console.log('[DB LOGIN] lodgeId:', state.lodgeId);
  console.log('[DB LOGIN] email:', normalizeEmail(email));
  clearBackendSession();
  await checkOnline();
  if (!state.lodgeId && !state.isOnline) {
    const result = {
      user: null,
      code: 'no_profile_selected',
      error: 'Connect to the internet and sign in once so this computer can download your lodge profile.'
    };
    authTrace('db.loginUser final return', result);
    return result;
  }
  const emailLower = normalizeEmail(email);

  if (state.isOnline) {
    // Only the picker may provide a company for an online sign-in. Do not turn
    // the previous local profile into an implicit choice for a multi-company
    // Restaurant & Bar account.
    const effectiveLodgeId = normalizeLodgeId(selectedLodgeId);
    const online = await authenticateOnline(emailLower, password, effectiveLodgeId);
    authTrace('db.loginUser online auth summary', {
      email: emailLower,
      effective_lodge_id: effectiveLodgeId,
      code: online?.code || null,
      source: online?.source || null,
      has_user: Boolean(online?.user),
      membership_count: Array.isArray(online?.memberships) ? online.memberships.length : null
    });
    if (online.user) {
      let authContext;
      try {
        applyBackendSession({
          token: online.session_token,
          expires_at: online.session_expires_at,
          session_type: 'desktop'
        });
        const authenticatedLodgeId = normalizeLodgeId(online.user?.lodge_id);
        if (!authenticatedLodgeId) {
          throw new Error('The server authenticated this user but did not return a lodge ID.');
        }
        authContext = await getLodgeAuthContext(authenticatedLodgeId);
        await assertAuthenticatedLodgeMatchesCurrentProduct(authenticatedLodgeId);
        if (!state.lodgeId || authenticatedLodgeId !== normalizeLodgeId(state.lodgeId)) {
          ensureReadyProfileForLodge(authenticatedLodgeId, {
            label: authContext?.lodge_display_name || online.user?.name || 'Existing Lodge'
          });
        }
      } catch (e) {
        const caught = /** @type {AuthCaughtErrorReadView | null | undefined} */ (e);
        clearBackendSession();
        console.error('[AUTH REAL ERROR]', {
          message: caught?.message,
          code: caught?.code,
          details: caught?.details,
          hint: caught?.hint,
          stack: caught?.stack
        });

        return {
          user: null,
          code: caught?.code || 'auth_failed_real',
          error: caught?.message || 'Unknown authentication error',
          details: {
            code: caught?.code,
            hint: caught?.hint,
            details: caught?.details
          }
        };
      }

      if (!authContext?.lodge_id || normalizeLodgeId(authContext.lodge_id) !== normalizeLodgeId(state.lodgeId)) {
        clearBackendSession();
        console.warn('[AUTH TRACE] schema error wrapper hit', {
          source: 'get_lodge_auth_context_mismatch',
          expected_lodge_id: state.lodgeId,
          returned_lodge_id: authContext?.lodge_id || null
        });
        const result = {
          user: null,
          code: 'auth_failed_real',
          error: 'get_lodge_auth_context returned a lodge_id that does not match this device.',
          details: {
            source: 'get_lodge_auth_context',
            expected_lodge_id: state.lodgeId,
            returned_lodge_id: authContext?.lodge_id || null
          }
        };
        authTrace('db.loginUser final return', result);
        return result;
      }
      if (authContext.deleted) {
        clearBackendSession();
        const result = { user: null, code: 'company_disabled', error: 'This company has been disabled. Contact support.' };
        authTrace('db.loginUser final return', result);
        return result;
      }
      try {
      const { data: outletAccess } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_user_outlet_access', {
          p_user_id: online.user.id,
          p_lodge_id: state.lodgeId
        });
        if (outletAccess) {
          online.user.allowed_outlet_ids = outletAccess.allowed_outlet_ids || [];
        }
      } catch {
        if (!online.user.allowed_outlet_ids) online.user.allowed_outlet_ids = [];
      }
      await touchUserPresence({
        userId: online.user.id,
        lodgeId: state.lodgeId,
        sessionType: 'desktop',
        markSignIn: true
      });
      if (online.source !== 'supabase_auth') {
        await createSupabaseAuthUserForStaff(emailLower, password);
      }
      await cacheSuccessfulLogin(online.user, emailLower, password);
      // Authentication is complete once the trusted session is cached.
      // Refreshing every operational table can be expensive for larger lodges,
      // so do it in the background instead of delaying or timing out login.
      refreshAllCaches().catch((error) => {
        console.warn('[AUTH] background cache refresh delayed:', (/** @type {AuthCaughtErrorReadView | null | undefined} */ (error))?.message || error);
      });
      const result = /** @type {AuthLoginOnlineSuccess} */ ({
        user: online.user,
        mode: 'online',
        source: online.source,
        session_token: online.session_token,
        session_expires_at: online.session_expires_at
      });
      authTrace('db.loginUser final return', { ...result, session_token: result.session_token ? '[present]' : null });
      return result;
    }

    // These are definitive online answers — never hide them behind offline fallback.
  /** @type {Set<unknown>} */
  const definitiveOnlineCodes = new Set([
      'wrong_password',
      'account_not_found',
      'wrong_lodge',
      'backend_auth_schema_outdated',
      'auth_failed_real',
      'company_selection_required',
      'invalid_company_selection',
      'multi_company_login_unavailable',
      'account_inactive',
      'company_disabled',
      'ambiguous_lodge',
      'product_profile_mismatch'
    ]);
    if (definitiveOnlineCodes.has(online.code)) {
      logAuthFailure(online.code, { email: emailLower });
      authTrace('db.loginUser final return', {
        ...online,
        memberships: Array.isArray(online.memberships) ? `[${online.memberships.length}]` : null
      });
      return online;
    }

    console.warn('[AUTH] offline fallback decision:', {
      email: emailLower,
      reason: online.code || 'server_unreachable',
      using_offline_fallback: true
    });
    const savedSession = restoreSavedTrustedSession(emailLower, password);
    if (savedSession.user) {
      try {
        assertOfflineSessionMatchesCurrentProduct(savedSession.user);
      } catch (e) {
        const caught = /** @type {AuthCaughtErrorReadView | null | undefined} */ (e);
        const result = {
          user: null,
          code: caught?.code || 'product_profile_mismatch',
          error: caught?.message || 'This saved session belongs to a different Tsa Bonno product.'
        };
        authTrace('db.loginUser final return', result);
        return result;
      }
      /** @type {Extract<AuthLoginResult, {mode: 'offline_trusted_session'}>} */
      const result = {
        user: savedSession.user,
        mode: 'offline_trusted_session',
        warning: 'Opened the saved trusted session because the server could not verify the account right now.'
      };
      authTrace('db.loginUser final return', result);
      return result;
    }
    logAuthFailure(online.code || 'server_unreachable', { email: emailLower });
    const result = {
      user: null,
      code: savedSession.code || online.code || 'server_unreachable',
      error: savedSession.error
        || online.error
        || 'The server could not verify this sign-in, and this account has no saved offline session on this computer yet.',
      memberships: online.memberships || []
    };
    authTrace('db.loginUser final return', result);
    return result;
  }

  console.warn('[AUTH] offline fallback decision:', {
    email: emailLower,
    reason: 'offline_mode',
    using_offline_fallback: true
  });
  const savedSession = restoreSavedTrustedSession(emailLower, password);
  if (savedSession.user) {
    try {
      assertOfflineSessionMatchesCurrentProduct(savedSession.user);
    } catch (e) {
      const caught = /** @type {AuthCaughtErrorReadView | null | undefined} */ (e);
      const result = {
        user: null,
        code: caught?.code || 'product_profile_mismatch',
        error: caught?.message || 'This saved session belongs to a different Tsa Bonno product.'
      };
      authTrace('db.loginUser final return', result);
      return result;
    }
    /** @type {Extract<AuthLoginResult, {mode: 'offline_trusted_session'}>} */
    const result = {
      user: savedSession.user,
      mode: 'offline_trusted_session',
      warning: 'Opened the saved trusted session while offline.'
    };
    authTrace('db.loginUser final return', result);
    return result;
  }
  const result = {
    user: null,
    code: savedSession.code || 'no_saved_trusted_session',
    error: savedSession.error || 'No saved trusted session was found on this computer. Connect to the internet and sign in once, then offline access will work for this device.'
  };
  authTrace('db.loginUser final return', result);
  return result;
}
