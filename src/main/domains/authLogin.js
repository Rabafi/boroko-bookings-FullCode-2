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
import { checkOnline } from './connectivity.js';
import { restoreSavedTrustedSession } from './authSession.js';
import {
  isBackendAuthSchemaError,
  normalizeEmail,
  normalizeLodgeId,
  normalizeUserRecord
} from './shared.js';

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY;

function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  try {
    console.log(`[AUTH TRACE] ${label}`, payload);
  } catch {
    // Best-effort debug logging only.
  }
}

export function getAuthClientState(clientLabel, sessionToken = null, email = null) {
  return {
    clientLabel,
    lodge_id: state.lodgeId,
    email,
    current_session_token_present: !!state.backendSession?.token,
    current_session_token_length: state.backendSession?.token ? state.backendSession.token.length : null,
    explicit_session_token_present: !!sessionToken,
    explicit_session_token_length: sessionToken ? sessionToken.length : null
  };
}

export function normalizeAuthContractRow(row) {
  if (!row || typeof row !== 'object') {
    return { ok: false, reason: 'authenticate_user returned no result.' };
  }
  const normalized = {
    found: typeof row.found === 'boolean' ? row.found : Boolean(row.id || row.email),
    authenticated: typeof row.authenticated === 'boolean' ? row.authenticated : false,
    id: row.id || null,
    email: normalizeEmail(row.email),
    role: row.role || null,
    lodge_id: normalizeLodgeId(row.lodge_id),
    name: row.name || '',
    password_hash: row.password_hash || null,
    session_token: row.session_token || null,
    session_expires_at: row.session_expires_at || null
  };

  const missingCoreFields =
  !normalized.lodge_id ||
  !Object.prototype.hasOwnProperty.call(row, 'found') ||
  !Object.prototype.hasOwnProperty.call(row, 'authenticated');

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

export function removeAuthEntry(email) {
  const emailLower = normalizeEmail(email);
  const filtered = readAuthCache().filter((e) => !(e.email === emailLower && e.lodge_id === state.lodgeId));
  writeAuthCache(filtered);
}

export function upsertAuthEntry(email, passwordHash) {
  const emailLower = normalizeEmail(email);
  const entries = readAuthCache().filter((e) => !(e.email === emailLower && e.lodge_id === state.lodgeId));
  entries.push({ email: emailLower, lodge_id: state.lodgeId, password_hash: passwordHash, deprecated: true });
  writeAuthCache(entries);
}

async function cacheSuccessfulLogin(user, emailLower, password = null) {
  console.log('[AUTH] cache write start:', { email: emailLower, userId: user?.id, lodge_id: state.lodgeId });
  if (typeof password === 'string' && password) {
    const localHash = await bcrypt.hash(password, 10);
    upsertAuthEntry(emailLower, localHash);
  }
  upsertCachedUser(user);
  const authEntries = readAuthCache().filter((entry) => entry.email === emailLower && entry.lodge_id === state.lodgeId);
  const cachedUser = getCachedUser(emailLower);
  console.log('[AUTH] cache write result:', {
    email: emailLower,
    auth_entry_written: authEntries.length > 0,
    cached_user_written: !!cachedUser,
    cached_user_id: cachedUser?.id || null
  });
}

export function getCachedUser(emailLower) {
  const normalizedEmail = normalizeEmail(emailLower);
  return readCache('users').
  map(normalizeUserRecord).
  find((u) => u?.email === normalizedEmail && (u.lodge_id ? u.lodge_id === state.lodgeId : true));
}

function logAuthFailure(reason, details = {}) {
  console.warn('[AUTH] login failed:', {
    reason,
    lodge_id: state.lodgeId,
    email: details.email,
    online: state.isOnline,
    ...details
  });
}

export function toSafeUser(user) {
  const {
    password_hash: _ph,
    session_token: _st,
    session_expires_at: _se,
    ...safeUser
  } = user;
  return safeUser;
}

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
        message: error.message || 'authenticate_user failed.',
        code: error.code || null,
        details: error.details || null,
        hint: error.hint || null,
        stack: error.stack || null
      }
    });
    return {
      rpcResult: { error: { message: error.message || 'authenticate_user failed.' } },
      rpcRow: null,
      contract: { ok: false, reason: error.message || 'authenticate_user failed.' }
    };
  }
}

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

async function findRemoteUsersByEmailForCurrentLodge(emailLower) {
  try {
    const { data, error } = await state.supabase.
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

async function authenticateOnline(emailLower, password) {
  const supabaseAuth = await authenticateWithSupabaseAuth(emailLower, password);
  if (
    supabaseAuth.user ||
    !['supabase_auth_unavailable', 'supabase_auth_not_migrated'].includes(supabaseAuth.code)
  ) {
    return supabaseAuth;
  }

  let rpcResult;
  let rpcRow;
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
            message: error.message || 'authenticate_user failed.',
            code: error.code || null,
            details: error.details || null,
            hint: error.hint || null,
            stack: error.stack || null
          }
        });
        return {
          rpcResult: { error: { message: error.message || 'authenticate_user failed.' } },
          rpcRow: null,
          contract: { ok: false, reason: error.message || 'authenticate_user failed.' }
        };
      }
    })(),
    timeoutPromise]
    );
    rpcResult = authResult.rpcResult;
    rpcRow = authResult.rpcRow;
    contract = authResult.contract;
  } catch (e) {
    return { user: null, code: 'server_unreachable', error: e.message };
  }

  console.log('[AUTH] online auth result:', {
    email: emailLower,
    lodge_id: state.lodgeId,
    rpc_error: rpcResult.error?.message || null,
    contract_ok: contract.ok,
    contract_reason: contract.reason || null,
    found: contract.row?.found ?? null,
    user_id: contract.row?.id || null
  });
  authTrace('db.loginUser online auth result', {
    email: emailLower,
    lodge_id: state.lodgeId,
    rpc_error: rpcResult.error?.message || null,
    contract_ok: contract.ok,
    contract_reason: contract.reason || null,
    found: contract.row?.found ?? null,
    authenticated: contract.row?.authenticated ?? null,
    user_id: contract.row?.id || null
  });

  if (rpcResult.error) {
    const errorMessage = rpcResult.error.message || 'authenticate_user failed.';
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

async function authenticateWithSupabaseAuth(emailLower, password) {
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

    const { data, error } = await authClient.rpc('authenticate_user_from_supabase', {
      p_lodge_id: state.lodgeId,
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
    if (!normalized.authenticated || !normalized.session_token) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: 'The server did not issue a valid Boroko session for this Supabase Auth user.',
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
    return {
      user: null,
      code: 'supabase_auth_unavailable',
      error: error?.message || 'Supabase Auth could not be reached.'
    };
  }
}

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
      console.warn('[AUTH] Supabase Auth admin staff create failed:', {
        email: emailLower,
        message: error?.message || 'unknown_error'
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
    console.warn('[AUTH] Supabase Auth staff signup failed:', {
      email: emailLower,
      message: error?.message || 'unknown_error'
    });
    return null;
  }
}

export async function loginUser(email, password) {
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
  if (!state.lodgeId) {
    const result = {
      user: null,
      code: 'no_profile_selected',
      error: 'Choose a lodge on this computer before staff sign-in.'
    };
    authTrace('db.loginUser final return', result);
    return result;
  }
  await checkOnline();
  const emailLower = normalizeEmail(email);

  if (state.isOnline) {
    const online = await authenticateOnline(emailLower, password);
    if (online.user) {
      let authContext;
      try {
        applyBackendSession({
          token: online.session_token,
          expires_at: online.session_expires_at,
          session_type: 'desktop'
        });
        authContext = await getLodgeAuthContext();
      } catch (e) {
        clearBackendSession();
        console.error('[AUTH REAL ERROR]', {
          message: e?.message,
          code: e?.code,
          details: e?.details,
          hint: e?.hint,
          stack: e?.stack
        });

        return {
          user: null,
          code: 'auth_failed_real',
          error: e?.message || 'Unknown authentication error',
          details: {
            code: e?.code,
            hint: e?.hint,
            details: e?.details
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
        const { data: outletAccess } = await state.supabase.rpc('get_user_outlet_access', {
          p_user_id: online.user.id,
          p_lodge_id: state.lodgeId
        });
        if (outletAccess) {
          online.user.allowed_outlet_ids = outletAccess.allowed_outlet_ids || [];
        }
      } catch {
        if (!online.user.allowed_outlet_ids) online.user.allowed_outlet_ids = [];
      }
      if (online.source !== 'supabase_auth') {
        await createSupabaseAuthUserForStaff(emailLower, password);
      }
      await cacheSuccessfulLogin(online.user, emailLower, password);
      const result = {
        user: online.user,
        mode: 'online',
        source: online.source,
        session_token: online.session_token,
        session_expires_at: online.session_expires_at
      };
      authTrace('db.loginUser final return', { ...result, session_token: result.session_token ? '[present]' : null });
      return result;
    }

    if (online.code === 'wrong_password' || online.code === 'account_not_found' || online.code === 'wrong_lodge' || online.code === 'backend_auth_schema_outdated' || online.code === 'auth_failed_real') {
      logAuthFailure(online.code, { email: emailLower });
      authTrace('db.loginUser final return', online);
      return online;
    }

    console.warn('[AUTH] offline fallback decision:', {
      email: emailLower,
      reason: online.code || 'server_unreachable',
      using_offline_fallback: true
    });
    const savedSession = restoreSavedTrustedSession(emailLower, password);
    if (savedSession.user) {
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
      error: savedSession.error || 'The server could not verify this sign-in, and this account has no saved offline session on this computer yet.'
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
