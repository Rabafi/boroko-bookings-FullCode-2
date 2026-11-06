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
import { getRuntimeProductId } from '../../shared/productIdentity.js';
import { getCommercialFeatureSet } from '../../shared/commercialAccess.js';

/**
 * Cache and RPC values remain unvalidated. This view describes only fields
 * consumed by entitlement calculation and does not establish their validity.
 * @typedef {Record<string, unknown> & {
 *   lodge_id?: unknown, status?: unknown, trial_ends_at?: unknown, expires_at?: unknown,
 *   offline_valid_until?: unknown, offlineValidUntil?: unknown, cached_at?: unknown,
 *   plan?: unknown, subscription_plan?: unknown, payment_status?: unknown,
 *   billing_status?: unknown, subscription_state?: unknown, expired?: unknown,
 *   daysLeft?: unknown, days_left?: unknown, monthly_fee?: unknown, next_due_date?: unknown,
 *   currency?: unknown, lodge_name?: unknown, product_id?: unknown,
 *   commercial_package_key?: unknown, commercial_catalog_version?: unknown,
 *   commercial_pricing_snapshot?: unknown, enterprise_addons?: unknown,
 *   plan_version_code?: unknown, grace_period_days?: unknown, grace_period_ends_at?: unknown,
 *   offline_lease_days?: unknown, effective_features?: unknown, success?: unknown, error?: unknown
 * }} EntitlementExpectedView
 */
/** @typedef {{feature_name?: unknown, enabled?: unknown}} EntitlementFeatureOverrideExpectedView */
/** @typedef {{message?: unknown, code?: unknown}} EntitlementErrorExpectedView */

export { refreshCachedTrialCountdown } from './trialCountdown.js';

/** @type {Map<string, {result: EntitlementExpectedView, cachedAt: number}>} */
const _entitlementCache = new Map()
/** @type {Map<string, Promise<EntitlementExpectedView>>} */
const _entitlementRequests = new Map()
const ENTITLEMENT_CACHE_TTL_MS = 2 * 60_000
// Entitlement is an authorization boundary. Give the authoritative RPC enough
// time to complete on a cold authenticated session before falling back to a
// local trial date, which may predate a later active license.
const ENTITLEMENT_RPC_TIMEOUT_MS = 15 * 1000

/** @param {string} targetLodgeId */
async function getProductAwareEntitlement(targetLodgeId) {
  const productId = getRuntimeProductId()
  const productResult = await supabaseRpcWithTimeout(/** @type {NonNullable<typeof state.supabase>} */ (state.supabase), 'get_lodge_entitlement', {
    p_lodge_id: targetLodgeId,
    p_product_id: productId
  }, ENTITLEMENT_RPC_TIMEOUT_MS)
  if (!productResult.error) return productResult

  // Preserve LodgingOS compatibility during a staged migration rollout. Hotel
  // and POS must fail over to their product-filtered legacy read instead of
  // accepting a different executable's one-argument entitlement.
  if (productId === 'lodge-camp' && isMissingEntitlementRpcError(productResult.error)) {
    return supabaseRpcWithTimeout(/** @type {NonNullable<typeof state.supabase>} */ (state.supabase), 'get_lodge_entitlement', {
      p_lodge_id: targetLodgeId
    }, ENTITLEMENT_RPC_TIMEOUT_MS)
  }
  return productResult
}

// Drop only the in-memory authorization result. The disk cache remains an
// offline fallback, while the next online read is forced through the
// authoritative entitlement RPC.
/** @param {string|null} [lodgeId] */
export function invalidateTrialStatus(lodgeId = null) {
  if (lodgeId) {
    _entitlementCache.delete(lodgeId)
    return
  }
  _entitlementCache.clear()
}

/** @param {unknown} error */
export function isMissingEntitlementRpcError(error) {
  const errorView = /** @type {EntitlementErrorExpectedView|null|undefined} */ (error);
  const message = String(errorView?.message || '');
  return errorView?.code === 'PGRST202' ||
  /schema cache/i.test(message) ||
  /operator does not exist: text = uuid/i.test(message);
}

/** @param {import('@supabase/supabase-js').SupabaseClient} client @param {string} rpcName @param {Record<string, unknown>} params @param {number} timeoutMs */
function supabaseRpcWithTimeout(client, rpcName, params, timeoutMs) {
  const rpcPromise = client.rpc(rpcName, params);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${rpcName} timed out after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([rpcPromise, timeoutPromise]);
}

/** @returns {Promise<string|null>} */
async function getActiveProfileLodgeId() {
  if (state.lodgeId) return state.lodgeId;
  const { getActiveProfile } = await import('./' + 'profiles.js');
  return getActiveProfile()?.lodge_id || null;
}

/** @param {string|null} [targetLodgeId] @returns {EntitlementExpectedView|null} */
function getCachedEntitlement(targetLodgeId = null) {
  const cached = readCache('trial_status');
  if (!cached || typeof cached !== 'object') return null;
  const cachedView = /** @type {EntitlementExpectedView} */ (cached);
  const refreshed = /** @type {EntitlementExpectedView} */ (refreshCachedTrialCountdown(cachedView));
  if (targetLodgeId && String(refreshed.lodge_id || '').trim().toLowerCase() !== String(targetLodgeId || '').trim().toLowerCase()) {
    // Covers both wrong-tenant snapshots and lodge-less legacy snapshots:
    // the latter are handled exclusively by the trusted adapter below.
    return null;
  }
  if (refreshed.status === 'expired' && cachedView.status === 'trial') return refreshed;
  const offlineValidUntil = cachedView.offline_valid_until ||
  cachedView.offlineValidUntil || (
  cachedView.cached_at ? addDays(/** @type {string|number} */ (cachedView.cached_at), DEFAULT_OFFLINE_LEASE_DAYS).toISOString() : null);
  if (offlineValidUntil) {
    const validUntilDate = new Date(/** @type {string|number} */ (offlineValidUntil));
    if (Number.isFinite(validUntilDate.getTime()) && validUntilDate < new Date()) {
      return null;
    }
  }
  return refreshed;
}

/**
 * Trusted adapter for lodge-less legacy disk snapshots. A snapshot without
 * tenant provenance is bound to the requested lodge ONLY when this device
 * holds exactly one company profile (no ambiguity about ownership), passes
 * the same offline-lease checks as stamped entries, and is written back
 * stamped so the legacy form disappears. Multi-profile devices must refresh
 * online instead of guessing ownership.
 */
/** @param {string} targetLodgeId @returns {Promise<EntitlementExpectedView|null>} */
async function getLegacyBoundEntitlement(targetLodgeId) {
  if (!targetLodgeId) return null;
  const cached = readCache('trial_status');
  if (!cached || typeof cached !== 'object') return null;
  const cachedView = /** @type {EntitlementExpectedView} */ (cached);
  if (String(cachedView.lodge_id || '').trim()) return null;
  let singleProfile = false;
  try {
    const profiles = await import('./' + 'profiles.js');
    const list = (profiles.getProfiles?.() || []).filter((/** @type {{lodge_id?: unknown}|null|undefined} */ profile) => profile?.lodge_id);
    singleProfile = list.length === 1;
  } catch {
    singleProfile = false;
  }
  if (!singleProfile) return null;
  const refreshed = /** @type {EntitlementExpectedView} */ (refreshCachedTrialCountdown(cachedView));
  const offlineValidUntil = cachedView.offline_valid_until ||
  cachedView.offlineValidUntil || (
  cachedView.cached_at ? addDays(/** @type {string|number} */ (cachedView.cached_at), DEFAULT_OFFLINE_LEASE_DAYS).toISOString() : null);
  if (offlineValidUntil) {
    const validUntilDate = new Date(/** @type {string|number} */ (offlineValidUntil));
    if (!Number.isFinite(validUntilDate.getTime()) || validUntilDate < new Date()) {
      return null;
    }
  }
  return cacheEntitlement(targetLodgeId, refreshed);
}

/** @param {string|null} targetLodgeId @param {EntitlementExpectedView} entitlement */
function cacheEntitlement(targetLodgeId, entitlement) {
  const cached = {
    ...entitlement,
    lodge_id: targetLodgeId || entitlement?.lodge_id || null,
    cached_at: new Date().toISOString()
  };
  writeCache('trial_status', cached);
  return cached;
}

/** @param {EntitlementExpectedView} [entitlement] @param {string|null} [lodgeId] @returns {EntitlementExpectedView} */
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

/** @param {string|number|null} [trialStartedAt] @param {string|null} [lodgeId] @returns {EntitlementExpectedView} */
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
  const msLeft = trialEnd.getTime() - new Date().getTime();
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

/** @param {EntitlementExpectedView} license @param {EntitlementFeatureOverrideExpectedView[]} [featureOverrides] @returns {EntitlementExpectedView} */
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

  const pricingSnapshot = /** @type {{selection?: {selected_addon_keys?: unknown}}|null|undefined} */ (license?.commercial_pricing_snapshot);
  const commercialAddonKeys = pricingSnapshot?.selection?.selected_addon_keys;
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

/** @param {unknown} payload @param {string|null} [requestedLodgeId] @returns {EntitlementExpectedView|null} */
function coerceEntitlementResponse(payload, requestedLodgeId = null) {
  if (!payload || typeof payload !== 'object') return null;
  const entitlementPayload = /** @type {EntitlementExpectedView} */ (payload);
  const requested = requestedLodgeId ? String(requestedLodgeId).trim().toLowerCase() : null;
  const responseLodge = entitlementPayload.lodge_id ? String(entitlementPayload.lodge_id).trim().toLowerCase() : null;
  // Fail closed when the server answers for a different tenant than the one
  // requested. When the response carries no tenant, bind the requested lodge:
  // the RPC was scoped with p_lodge_id=requested under RLS, so the answer is
  // inherently about that tenant — this is the trusted adapter, not a guess.
  if (requested && responseLodge && responseLodge !== requested) return null;
  const normalizedPlan = entitlementPayload.plan ? normalizePlanName(entitlementPayload.plan) : entitlementPayload.status === 'trial' ? 'Trial' : null;
  const effectiveFeatures = mergeFeatureOverrides(
    getPlanFeatureMap(normalizedPlan || 'Starter', {
      trial: entitlementPayload.status === 'trial',
      expired: entitlementPayload.expired === true
    }),
    Object.entries(entitlementPayload.effective_features || {}).map(([feature_name, enabled]) => ({ feature_name, enabled }))
  );

  const commercialAddonKeys = entitlementPayload.enterprise_addons
    || /** @type {{selection?: {selected_addon_keys?: unknown}}|null|undefined} */ (entitlementPayload.commercial_pricing_snapshot)?.selection?.selected_addon_keys;
  // Older RPCs return base-package features alongside the approved addon
  // selection. Resolve those grants before legacy plan defaults; explicit
  // server denials and product-scoped overrides retain precedence.
  const boundPayload = { ...entitlementPayload, lodge_id: responseLodge ? entitlementPayload.lodge_id : (requestedLodgeId || null) };
  if (entitlementPayload.product_id === 'hospitality-pos') {
    for (const feature of getCommercialFeatureSet(
      /** @type {string|null} */ (entitlementPayload.product_id),
      /** @type {string|null} */ (entitlementPayload.commercial_package_key),
      /** @type {string[]} */ (Array.isArray(commercialAddonKeys) ? commercialAddonKeys : []), boundPayload, requestedLodgeId
    )) {
      if (!Object.prototype.hasOwnProperty.call(entitlementPayload.effective_features || {}, feature)) effectiveFeatures[feature] = true;
    }
  }
  return {
    ...entitlementPayload,
    lodge_id: boundPayload.lodge_id,
    plan: normalizedPlan,
    expired: entitlementPayload.expired === true,
    daysLeft: entitlementPayload.daysLeft ?? entitlementPayload.days_left ?? null,
    payment_status: entitlementPayload.payment_status || entitlementPayload.billing_status || null,
    subscription_state: entitlementPayload.subscription_state || null,
    plan_version_code: entitlementPayload.plan_version_code || null,
    grace_period_days: entitlementPayload.grace_period_days ?? null,
    grace_period_ends_at: entitlementPayload.grace_period_ends_at || null,
    offline_lease_days: entitlementPayload.offline_lease_days ?? null,
    offline_valid_until: entitlementPayload.offline_valid_until || entitlementPayload.offlineValidUntil || null,
    enterprise_addons: Array.isArray(commercialAddonKeys) ? commercialAddonKeys : [],
    effective_features: effectiveFeatures
  };
}

// Test seam: pure tenant binding for the authoritative fetch path.
export { coerceEntitlementResponse as coerceEntitlementResponseForTenant };

/**
 * Read the live server entitlement without any disk, legacy-query, or trial
 * fallback. Use this for provisioning high-risk access where a stale offline
 * lease must never authorize a new capability.
 */
export async function getAuthoritativeTrialStatus(lodgeId) {
  const targetLodgeId = lodgeId || await getActiveProfileLodgeId();
  if (!targetLodgeId || state.isOnline !== true || !state.supabase) {
    throw new Error('A live entitlement connection is required.');
  }

  const { data, error } = await getProductAwareEntitlement(targetLodgeId);
  if (error) throw new Error(error.message || 'The live entitlement could not be verified.');

  const normalized = coerceEntitlementResponse(data, targetLodgeId);
  if (!normalized) throw new Error('The live entitlement response was invalid or belongs to a different tenant.');
  _entitlementCache.set(targetLodgeId, { result: normalized, cachedAt: Date.now() });
  return cacheEntitlement(targetLodgeId, normalized);
}

/** @param {string} targetLodgeId @returns {Promise<EntitlementFeatureOverrideExpectedView[]>} */
async function getLegacyFeatureOverrides(targetLodgeId) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).
  from('lodge_features').
  select('feature_name, enabled').
  eq('lodge_id', targetLodgeId);
  if (error) throw new Error(error.message);
  return /** @type {EntitlementFeatureOverrideExpectedView[]} */ (data || []);
}

/** @param {string} targetLodgeId @returns {Promise<EntitlementExpectedView>} */
async function getLegacyEntitlement(targetLodgeId) {
  const now = new Date().toISOString();
  const productId = getRuntimeProductId()
  let licenseQuery = /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).
  from('licenses').
  select('id, lodge_id, lodge_name, expires_at, subscription_plan, monthly_fee, payment_status, next_due_date, currency, is_active, plan_version_code, grace_period_days, offline_lease_days, product_id, commercial_package_key, commercial_catalog_version, commercial_pricing_snapshot').
  eq('lodge_id', targetLodgeId).
  eq('is_active', true).
  or(`expires_at.is.null,expires_at.gt.${now}`)
  licenseQuery = productId === 'lodge-camp'
    ? licenseQuery.or('product_id.eq.lodge-camp,product_id.is.null')
    : licenseQuery.eq('product_id', productId)
  const { data: licenseRows, error: licenseError } = await licenseQuery.
  order('issued_at', { ascending: false }).
  limit(1);

  if (licenseError) throw new Error(licenseError.message);
  const license = Array.isArray(licenseRows) ? /** @type {EntitlementExpectedView|null} */ (licenseRows[0]) : null;
  if (license) {
    const overrides = await getLegacyFeatureOverrides(targetLodgeId).catch(() => []);
    return buildLicensedEntitlement(license, overrides);
  }

  const cachedSettings = /** @type {EntitlementExpectedView[]} */ (readCache('settings'))[0] || null;
  if (cachedSettings?.trial_started_at) {
    return buildTrialEntitlement(cachedSettings.trial_started_at, targetLodgeId);
  }

  const { data: settings, error: settingsError } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).
  from('settings').
  select('trial_started_at').
  eq('lodge_id', targetLodgeId).
  maybeSingle();
  if (settingsError) throw new Error(settingsError.message);
  return buildTrialEntitlement(settings?.trial_started_at || null, targetLodgeId);
}

/** @param {string|null} [lodgeId] @param {{forceFresh?: boolean}} [options] @returns {Promise<EntitlementExpectedView>} */
export async function getTrialStatus(lodgeId, options = {}) {
  const targetLodgeId = lodgeId || await getActiveProfileLodgeId();
  if (!targetLodgeId) {
    return buildTrialEntitlement(null);
  }

  const forceFresh = options?.forceFresh === true
  if (forceFresh) invalidateTrialStatus(targetLodgeId)
  const cached = _entitlementCache.get(targetLodgeId)
  if (!forceFresh && cached && Date.now() - cached.cachedAt < ENTITLEMENT_CACHE_TTL_MS) {
    return cached.result
  }

  const existingRequest = forceFresh ? null : _entitlementRequests.get(targetLodgeId)
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

/** @param {string} targetLodgeId @returns {Promise<EntitlementExpectedView>} */
async function loadTrialStatus(targetLodgeId) {
  const onlineCheck = checkOnline();
  const checkTimeout = /** @type {Promise<'timeout'>} */ (new Promise((r) => setTimeout(() => r('timeout'), 3000)));
  const checkResult = /** @type {boolean|'timeout'} */ (await Promise.race([onlineCheck, checkTimeout]));
  if (checkResult === 'timeout' || !state.isOnline) {
    const cached = getCachedEntitlement(targetLodgeId);
    if (cached) return cached;
    const legacyBound = await getLegacyBoundEntitlement(targetLodgeId);
    if (legacyBound) return legacyBound;
    const staleCached = readCache('trial_status');
    if (staleCached && typeof staleCached === 'object') {
      return buildOfflineLeaseExpiredEntitlement(/** @type {EntitlementExpectedView} */ (staleCached), targetLodgeId);
    }
    const cachedSettings = /** @type {EntitlementExpectedView[]} */ (readCache('settings'))[0] || null;
    return buildTrialEntitlement(cachedSettings?.trial_started_at || null, targetLodgeId);
  }

  try {
    const { data, error } = await getProductAwareEntitlement(targetLodgeId);
    if (error) throw error;
    const normalized = coerceEntitlementResponse(data, targetLodgeId);
    if (normalized) {
      _entitlementCache.set(targetLodgeId, { result: normalized, cachedAt: Date.now() })
      return cacheEntitlement(targetLodgeId, normalized);
    }
  } catch (error) {
    if (!isMissingEntitlementRpcError(error) && !getCachedEntitlement(targetLodgeId)) {
      console.warn('[ENTITLEMENT] RPC failed, trying legacy fallback:', (/** @type {EntitlementErrorExpectedView} */ (error)).message);
    }
  }

  try {
    const legacyResult = await getLegacyEntitlement(targetLodgeId)
    _entitlementCache.set(targetLodgeId, { result: legacyResult, cachedAt: Date.now() })
    return cacheEntitlement(targetLodgeId, legacyResult);
  } catch (error) {
    if (!getCachedEntitlement(targetLodgeId)) {
      console.warn('[ENTITLEMENT] legacy fallback failed:', (/** @type {EntitlementErrorExpectedView} */ (error)).message);
    }
    const cached = getCachedEntitlement(targetLodgeId);
    if (cached) return cached;
    const legacyBound = await getLegacyBoundEntitlement(targetLodgeId);
    if (legacyBound) return legacyBound;
    const staleCached = readCache('trial_status');
    if (staleCached && typeof staleCached === 'object') {
      const result = buildOfflineLeaseExpiredEntitlement(/** @type {EntitlementExpectedView} */ (staleCached), targetLodgeId);
      return cacheEntitlement(targetLodgeId, result);
    }
    const cachedSettings = /** @type {EntitlementExpectedView[]} */ (readCache('settings'))[0] || null;
    const result = buildTrialEntitlement(cachedSettings?.trial_started_at || null, targetLodgeId);
    return cacheEntitlement(targetLodgeId, result);
  }
}

/** @param {string} lodgeId @param {string} licenseKey */
export async function activateLicenseKey(lodgeId, licenseKey) {
  if (!state.isOnline) throw new Error('Internet connection required to activate license.');
  if (!licenseKey?.trim()) throw new Error('Please enter a license key.');

  const key = licenseKey.trim().toUpperCase();
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('activate_license_key', {
      p_lodge_id: lodgeId,
      p_license_key: key
    });
    if (error) throw error;
    const normalized = coerceEntitlementResponse(data, lodgeId);
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
    if (isMissingEntitlementRpcError(error)) {
      throw new Error('License activation requires the latest database migration. Apply pending Supabase migrations, then retry activation through the commercial quote path.');
    }
    // Authoritative RPC denials (unknown key, deactivated, ineligible,
    // wrong tenant) are final: never fall through to a direct table write.
    throw error instanceof Error ? error : new Error(String((/** @type {EntitlementErrorExpectedView|null|undefined} */ (error))?.message || 'Activation failed'));
  }

  // Closed null-package shortcut: direct licenses-table activation bypassed
  // the commercial quote boundary (package/AddOn eligibility, catalogue
  // snapshot, audit). All activations must route through the authoritative
  // activate_license_key RPC / commercial quote path above. Reaching here
  // means the RPC returned no usable entitlement, so fail closed instead of
  // writing the licence row directly.
  throw new Error('License activation requires a commercial quote. Apply the latest database migrations and retry via Command Central activation (quote path).');
}
