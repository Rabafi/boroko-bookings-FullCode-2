import { state } from '../state.js';
import { readCache, writeCache } from './cacheStore.js';
import { checkOnline } from './connectivity.js';
import {
  DEFAULT_OFFLINE_LEASE_DAYS,
  DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  addDays,
  computeGracePeriodEnd,
  computeOfflineValidUntil,
  computeSubscriptionState,
  getPlanFeatureMap,
  mergeFeatureOverrides,
  normalizePlanName,
  subscriptionAllowsAccess,
  toPositiveInt
} from './subscriptionState.js';
import { refreshCachedTrialCountdown } from './trialCountdown.js';

export { refreshCachedTrialCountdown } from './trialCountdown.js';

const _entitlementCache = new Map()
const _entitlementRequests = new Map()
const ENTITLEMENT_CACHE_TTL_MS = 2 * 60_000
// Entitlement is an authorization boundary. Give the authoritative RPC enough
// time to complete on a cold authenticated session before falling back to a
// local trial date, which may predate a later active license.
const ENTITLEMENT_RPC_TIMEOUT_MS = 15 * 1000

export function isMissingEntitlementRpcError(error) {
  const message = String(error?.message || '');
  return error?.code === 'PGRST202' ||
  /schema cache/i.test(message) ||
  /operator does not exist: text = uuid/i.test(message);
}

function supabaseRpcWithTimeout(client, rpcName, params, timeoutMs) {
  const rpcPromise = client.rpc(rpcName, params);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${rpcName} timed out after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([rpcPromise, timeoutPromise]);
}

async function getActiveProfileLodgeId() {
  if (state.lodgeId) return state.lodgeId;
  const { getActiveProfile } = await import('./' + 'profiles.js');
  return getActiveProfile()?.lodge_id || null;
}

function getCachedEntitlement(targetLodgeId = null) {
  const cached = readCache('trial_status');
  if (!cached || typeof cached !== 'object') return null;
  const refreshed = refreshCachedTrialCountdown(cached);
  if (targetLodgeId && String(refreshed.lodge_id || '').trim().toLowerCase() !== String(targetLodgeId || '').trim().toLowerCase()) {
    return null;
  }
  if (refreshed.status === 'expired' && cached.status === 'trial') return refreshed;
  const offlineValidUntil = cached.offline_valid_until ||
  cached.offlineValidUntil || (
  cached.cached_at ? addDays(cached.cached_at, DEFAULT_OFFLINE_LEASE_DAYS).toISOString() : null);
  if (offlineValidUntil) {
    const validUntilDate = new Date(offlineValidUntil);
    if (Number.isFinite(validUntilDate.getTime()) && validUntilDate < new Date()) {
      return null;
    }
  }
  return refreshed;
}

function cacheEntitlement(targetLodgeId, entitlement) {
  const cached = {
    ...entitlement,
    lodge_id: targetLodgeId || entitlement?.lodge_id || null,
    cached_at: new Date().toISOString()
  };
  writeCache('trial_status', cached);
  return cached;
}

function buildOfflineLeaseExpiredEntitlement(entitlement = {}, lodgeId = null) {
  const normalizedPlan = entitlement.plan ? normalizePlanName(entitlement.plan) : normalizePlanName(entitlement.subscription_plan);
  return {
    ...entitlement,
    lodge_id: lodgeId || entitlement?.lodge_id || null,
    status: 'expired',
    expired: true,
    plan: normalizedPlan || null,
    subscription_state: 'offline_lease_expired',
    payment_status: entitlement?.payment_status || 'offline_lease_expired',
    daysLeft: null,
    offline_valid_until: entitlement?.offline_valid_until || entitlement?.offlineValidUntil || new Date().toISOString(),
    effective_features: normalizedPlan ? getPlanFeatureMap(normalizedPlan, { expired: true }) : getPlanFeatureMap('Starter', { expired: true })
  };
}

function buildTrialEntitlement(trialStartedAt = null, lodgeId = null) {
  if (!trialStartedAt) {
    return {
      lodge_id: lodgeId,
      status: 'trial',
      daysLeft: 30,
      expired: false,
      plan: 'Trial',
      payment_status: 'trial',
      subscription_state: 'trial',
      monthly_fee: 0,
      effective_features: getPlanFeatureMap('Pro', { trial: true }),
      trial_ends_at: null,
      expires_at: null,
      next_due_date: null,
      grace_period_days: 0,
      grace_period_ends_at: null,
      offline_lease_days: 30,
      offline_valid_until: computeOfflineValidUntil({
        subscription_state: 'trial',
        offline_lease_days: 30
      })
    };
  }

  const trialEnd = new Date(trialStartedAt);
  trialEnd.setDate(trialEnd.getDate() + 30);
  const msLeft = trialEnd - new Date();
  const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  const expired = daysLeft <= 0;

  return {
    lodge_id: lodgeId,
    status: expired ? 'expired' : 'trial',
    daysLeft,
    expired,
    plan: expired ? null : 'Trial',
    payment_status: expired ? 'expired' : 'trial',
    subscription_state: expired ? 'expired' : 'trial',
    monthly_fee: 0,
    effective_features: getPlanFeatureMap('Pro', { trial: !expired, expired }),
    trial_ends_at: trialEnd.toISOString(),
    expires_at: expired ? trialEnd.toISOString() : null,
    next_due_date: null,
    grace_period_days: 0,
    grace_period_ends_at: null,
    offline_lease_days: 30,
    offline_valid_until: computeOfflineValidUntil({
      subscription_state: expired ? 'expired' : 'trial',
      offline_lease_days: 30,
      trial_end: trialEnd.toISOString()
    })
  };
}

function buildLicensedEntitlement(license, featureOverrides = []) {
  const normalizedPlan = normalizePlanName(license?.subscription_plan);
  const paymentStatus = String(license?.payment_status || 'active').trim().toLowerCase() || 'active';
  const subscriptionState = computeSubscriptionState({
    payment_status: paymentStatus,
    next_due_date: license?.next_due_date || null,
    expires_at: license?.expires_at || null,
    is_active: license?.is_active !== false,
    grace_period_days: license?.grace_period_days || DEFAULT_SUBSCRIPTION_GRACE_DAYS
  });
  const activeAccess = subscriptionAllowsAccess(subscriptionState);
  const status = activeAccess ? 'licensed' : 'expired';
  const gracePeriodEndsAt = computeGracePeriodEnd(license?.next_due_date, license?.grace_period_days || DEFAULT_SUBSCRIPTION_GRACE_DAYS);

  const commercialAddonKeys = license?.commercial_pricing_snapshot?.selection?.selected_addon_keys;
  return {
    lodge_id: license?.lodge_id || null,
    status,
    daysLeft: null,
    expired: !activeAccess,
    plan: normalizedPlan,
    payment_status: paymentStatus,
    subscription_state: subscriptionState,
    expires_at: license?.expires_at || null,
    monthly_fee: Number(license?.monthly_fee || 0),
    next_due_date: license?.next_due_date || null,
    currency: license?.currency || null,
    lodge_name: license?.lodge_name || null,
    product_id: license?.product_id || null,
    commercial_package_key: license?.commercial_package_key || null,
    commercial_catalog_version: license?.commercial_catalog_version || null,
    commercial_pricing_snapshot: license?.commercial_pricing_snapshot || null,
    enterprise_addons: Array.isArray(commercialAddonKeys) ? commercialAddonKeys : [],
    plan_version_code: license?.plan_version_code || '2026.04',
    grace_period_days: toPositiveInt(license?.grace_period_days, DEFAULT_SUBSCRIPTION_GRACE_DAYS),
    grace_period_ends_at: gracePeriodEndsAt,
    offline_lease_days: toPositiveInt(license?.offline_lease_days, DEFAULT_OFFLINE_LEASE_DAYS),
    offline_valid_until: computeOfflineValidUntil({
      subscription_state: subscriptionState,
      expires_at: license?.expires_at || null,
      next_due_date: license?.next_due_date || null,
      grace_period_days: license?.grace_period_days || DEFAULT_SUBSCRIPTION_GRACE_DAYS,
      offline_lease_days: license?.offline_lease_days || DEFAULT_OFFLINE_LEASE_DAYS
    }),
    effective_features: activeAccess ?
    mergeFeatureOverrides(getPlanFeatureMap(normalizedPlan), featureOverrides) :
    getPlanFeatureMap(normalizedPlan, { expired: true })
  };
}

function coerceEntitlementResponse(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const normalizedPlan = payload.plan ? normalizePlanName(payload.plan) : payload.status === 'trial' ? 'Trial' : null;
  const effectiveFeatures = mergeFeatureOverrides(
    getPlanFeatureMap(normalizedPlan || 'Starter', {
      trial: payload.status === 'trial',
      expired: payload.expired === true
    }),
    Object.entries(payload.effective_features || {}).map(([feature_name, enabled]) => ({ feature_name, enabled }))
  );

  const commercialAddonKeys = payload.enterprise_addons
    || payload.commercial_pricing_snapshot?.selection?.selected_addon_keys;
  return {
    ...payload,
    lodge_id: payload.lodge_id || null,
    plan: normalizedPlan,
    expired: payload.expired === true,
    daysLeft: payload.daysLeft ?? payload.days_left ?? null,
    payment_status: payload.payment_status || payload.billing_status || null,
    subscription_state: payload.subscription_state || null,
    plan_version_code: payload.plan_version_code || null,
    grace_period_days: payload.grace_period_days ?? null,
    grace_period_ends_at: payload.grace_period_ends_at || null,
    offline_lease_days: payload.offline_lease_days ?? null,
    offline_valid_until: payload.offline_valid_until || payload.offlineValidUntil || null,
    enterprise_addons: Array.isArray(commercialAddonKeys) ? commercialAddonKeys : [],
    effective_features: effectiveFeatures
  };
}

async function getLegacyFeatureOverrides(targetLodgeId) {
  const { data, error } = await state.supabase.
  from('lodge_features').
  select('feature_name, enabled').
  eq('lodge_id', targetLodgeId);
  if (error) throw new Error(error.message);
  return data || [];
}

async function getLegacyEntitlement(targetLodgeId) {
  const now = new Date().toISOString();
  const { data: licenseRows, error: licenseError } = await state.supabase.
  from('licenses').
  select('id, lodge_id, lodge_name, expires_at, subscription_plan, monthly_fee, payment_status, next_due_date, currency, is_active, plan_version_code, grace_period_days, offline_lease_days, product_id, commercial_package_key, commercial_catalog_version, commercial_pricing_snapshot').
  eq('lodge_id', targetLodgeId).
  eq('is_active', true).
  or(`expires_at.is.null,expires_at.gt.${now}`).
  order('issued_at', { ascending: false }).
  limit(1);

  if (licenseError) throw new Error(licenseError.message);
  const license = Array.isArray(licenseRows) ? licenseRows[0] : null;
  if (license) {
    const overrides = await getLegacyFeatureOverrides(targetLodgeId).catch(() => []);
    return buildLicensedEntitlement(license, overrides);
  }

  const cachedSettings = readCache('settings')[0] || null;
  if (cachedSettings?.trial_started_at) {
    return buildTrialEntitlement(cachedSettings.trial_started_at);
  }

  const { data: settings, error: settingsError } = await state.supabase.
  from('settings').
  select('trial_started_at').
  eq('lodge_id', targetLodgeId).
  maybeSingle();
  if (settingsError) throw new Error(settingsError.message);
  return buildTrialEntitlement(settings?.trial_started_at || null);
}

export async function getTrialStatus(lodgeId, options = {}) {
  const targetLodgeId = lodgeId || await getActiveProfileLodgeId();
  if (!targetLodgeId) {
    return buildTrialEntitlement(null);
  }

  const cached = _entitlementCache.get(targetLodgeId)
  if (options.forceFresh !== true && cached && Date.now() - cached.cachedAt < ENTITLEMENT_CACHE_TTL_MS) {
    return cached.result
  }

  const existingRequest = _entitlementRequests.get(targetLodgeId)
  if (existingRequest) return existingRequest

  const request = loadTrialStatus(targetLodgeId)
  _entitlementRequests.set(targetLodgeId, request)
  try {
    return await request
  } finally {
    if (_entitlementRequests.get(targetLodgeId) === request) {
      _entitlementRequests.delete(targetLodgeId)
    }
  }
}

async function loadTrialStatus(targetLodgeId) {
  const onlineCheck = checkOnline();
  const checkTimeout = new Promise((r) => setTimeout(() => r('timeout'), 3000));
  const checkResult = await Promise.race([onlineCheck, checkTimeout]);
  if (checkResult === 'timeout' || !state.isOnline) {
    const cached = getCachedEntitlement(targetLodgeId);
    if (cached) return cached;
    const staleCached = readCache('trial_status');
    if (staleCached && typeof staleCached === 'object') {
      return buildOfflineLeaseExpiredEntitlement(staleCached, targetLodgeId);
    }
    const cachedSettings = readCache('settings')[0] || null;
    return buildTrialEntitlement(cachedSettings?.trial_started_at || null, targetLodgeId);
  }

  try {
    const { data, error } = await supabaseRpcWithTimeout(state.supabase, 'get_lodge_entitlement', {
      p_lodge_id: targetLodgeId
    }, ENTITLEMENT_RPC_TIMEOUT_MS);
    if (error) throw error;
    const normalized = coerceEntitlementResponse(data);
    if (normalized) {
      _entitlementCache.set(targetLodgeId, { result: normalized, cachedAt: Date.now() })
      return cacheEntitlement(targetLodgeId, normalized);
    }
  } catch (error) {
    if (!isMissingEntitlementRpcError(error) && !getCachedEntitlement(targetLodgeId)) {
      console.warn('[ENTITLEMENT] RPC failed, trying legacy fallback:', error.message);
    }
  }

  try {
    const legacyResult = await getLegacyEntitlement(targetLodgeId)
    _entitlementCache.set(targetLodgeId, { result: legacyResult, cachedAt: Date.now() })
    return cacheEntitlement(targetLodgeId, legacyResult);
  } catch (error) {
    if (!getCachedEntitlement(targetLodgeId)) {
      console.warn('[ENTITLEMENT] legacy fallback failed:', error.message);
    }
    const cached = getCachedEntitlement(targetLodgeId);
    if (cached) return cached;
    const staleCached = readCache('trial_status');
    if (staleCached && typeof staleCached === 'object') {
      const result = buildOfflineLeaseExpiredEntitlement(staleCached, targetLodgeId);
      return cacheEntitlement(targetLodgeId, result);
    }
    const cachedSettings = readCache('settings')[0] || null;
    const result = buildTrialEntitlement(cachedSettings?.trial_started_at || null, targetLodgeId);
    return cacheEntitlement(targetLodgeId, result);
  }
}

export async function activateLicenseKey(lodgeId, licenseKey) {
  if (!state.isOnline) throw new Error('Internet connection required to activate license.');
  if (!licenseKey?.trim()) throw new Error('Please enter a license key.');

  const key = licenseKey.trim().toUpperCase();
  try {
    const { data, error } = await state.supabase.rpc('activate_license_key', {
      p_lodge_id: lodgeId,
      p_license_key: key
    });
    if (error) throw error;
    const normalized = coerceEntitlementResponse(data);
    if (normalized?.success === false) throw new Error(normalized.error || 'Activation failed');
    if (normalized) {
      _entitlementCache.delete(lodgeId);
      cacheEntitlement(lodgeId, normalized);
      return {
        success: true,
        plan: normalized.plan || 'Starter',
        expires_at: normalized.expires_at,
        lodge_name: normalized.lodge_name
      };
    }
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) {
      console.warn('[ENTITLEMENT] activation RPC failed, trying legacy fallback:', error.message);
    }
  }

  const { data: license, error } = await state.supabase.
  from('licenses').
  select('*').
  eq('license_key', key).
  maybeSingle();

  if (error) throw new Error(error.message);
  if (!license) throw new Error('License key not found. Please check and try again.');
  if (!license.is_active) throw new Error('This license key has been deactivated.');
  if (String(license.payment_status || '').toLowerCase() === 'cancelled') {
    throw new Error('This license key has been cancelled.');
  }
  if (license.lodge_id && license.lodge_id !== 'unassigned' && license.lodge_id !== lodgeId) {
    throw new Error('This license key is already registered to another installation.');
  }
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    throw new Error('This license key has expired.');
  }

  const { error: updateError } = await state.supabase.
  from('licenses').
  update({ lodge_id: lodgeId }).
  eq('id', license.id);

  if (updateError) throw new Error(updateError.message);

  const overrides = await getLegacyFeatureOverrides(lodgeId).catch(() => []);
  const entitlement = buildLicensedEntitlement({ ...license, lodge_id: lodgeId }, overrides);
  _entitlementCache.delete(lodgeId);
  cacheEntitlement(lodgeId, entitlement);
  return {
    success: true,
    plan: entitlement.plan || 'Starter',
    expires_at: entitlement.expires_at,
    lodge_name: entitlement.lodge_name
  };
}
