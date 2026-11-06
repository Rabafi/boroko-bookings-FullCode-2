import { randomUUID } from 'crypto'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { state } from '../state.js'
import { writeAuthCache } from './authCache.js'
import { clearActivityLog } from './misc.js'
import { clearBackendSession } from './authClients.js'
import { clearCache } from './cacheStore.js'
import { refreshAllCaches } from './cacheRefresh.js'
import { checkOnline } from './connectivity.js'
import { ensureDir, readJsonFile, writeJsonFile } from './fileStore.js'
import { isUuid, normalizeLodgeId } from './shared.js'
import {
  readSyncMeta,
  writeFailedSyncQueue,
  writeSyncQueue
} from './syncStore.js'
import { clearSessionNonce } from './authSession.js'
import {
  getProductDefinition,
  getProductMismatchMessage,
  getRuntimeProductId,
  isProductCompatiblePropertyType
} from '../../shared/productIdentity.js'

/** Normalized producer view; dates preserve their existing raw JSON values. @typedef {import('../../shared/desktopIpcContracts.js').DesktopProfileReadView} ProfileExpectedData */
/** @typedef {import('../../shared/desktopIpcContracts.js').DesktopProfileListReadView} ProfileListItemExpectedData */
/** The registry file is still parsed as unvalidated JSON; this view only names fields read below. @typedef {{active_lodge_id?: unknown, profiles?: unknown}} ProfileRegistryInputExpectedView */
/** @typedef {{active_lodge_id: string|null, profiles: ProfileExpectedData[]}} ProfileRegistryExpectedData */
/** @typedef {{lodge_id?: unknown, label?: unknown, status?: unknown, created_at?: unknown, last_used_at?: unknown}} RawProfileExpectedView */
/** @typedef {{profiles?: unknown, active_lodge_id?: unknown}} RawProfileRegistryExpectedView */
/** @typedef {{property_type?: unknown, business_type?: unknown, setup_complete?: unknown, lodge_name?: unknown, company_name?: unknown, [key: string]: unknown}} ProfileSettingsExpectedView */
/** @typedef {Error & {code?: unknown}} ProfileErrorExpectedView */

/** @returns {string} */
function productBusinessTitle() {
  return getProductDefinition(getRuntimeProductId()).businessNounTitle || 'Lodge'
}

/** @returns {string} */
function defaultDraftLabel() {
  return `New ${productBusinessTitle()}`
}

/** @returns {string} */
function defaultUntitledLabel() {
  return `Untitled ${productBusinessTitle()}`
}

export const PROFILE_STATUS = {
  DRAFT: 'draft',
  READY: 'ready'
}

/** @returns {string} */
function getLodgeIdPath() {
  return path.join(app.getPath('userData'), 'lodge-id.json');
}

/** @returns {string} */
function getProfilesPath() {
  return path.join(app.getPath('userData'), 'profiles.json');
}

/** @returns {string|null} */
function readLegacyLodgeId() {
  const data = /** @type {{lodge_id?: unknown}|null} */ (readJsonFile(getLodgeIdPath(), null));
  return normalizeLodgeId(data?.lodge_id);
}

/** @param {string|null} id */
export function persistLegacyLodgeId(id) {
  writeJsonFile(getLodgeIdPath(), { lodge_id: id });
}

/** @param {unknown} profileLodgeId @returns {string} */
export function getProfileCacheDir(profileLodgeId) {
  // Profile runtime initializes both paths before callers reach this helper;
  // these assertions do not add a fallback or change path.join's error on invalid values.
  return path.join(/** @type {string} */ (state.profilesCacheDir), /** @type {string} */ (normalizeLodgeId(profileLodgeId)));
}

/** @param {ProfileExpectedData} profile */
function isProfileCompatibleWithCurrentProduct(profile) {
  if (profile?.status === PROFILE_STATUS.DRAFT) return true;
  const cached = readJsonFile(path.join(getProfileCacheDir(profile?.lodge_id), 'settings.json'), []);
  const settings = /** @type {ProfileSettingsExpectedView|null|undefined} */ (Array.isArray(cached) ? cached[0] : cached);
  const propertyType = settings?.property_type || settings?.business_type || 'lodge';
  return isProductCompatiblePropertyType(getRuntimeProductId(), propertyType);
}

/** @param {string} [propertyType] */
function productMismatchError(propertyType = '') {
  const error = new Error(
    propertyType
      ? getProductMismatchMessage(getRuntimeProductId(), propertyType)
      : 'This saved business belongs to a different Tsa Bonno product. Open it with its matching app instead.'
  );
  /** @type {ProfileErrorExpectedView} */ (error).code = 'product_profile_mismatch';
  return error;
}

function getInactiveCacheDir() {
  return path.join(/** @type {string} */ (state.cacheRootDir), '__inactive');
}

/** @param {unknown} rawProfile @returns {ProfileExpectedData|null} */
export function sanitizeProfile(rawProfile) {
  const profileView = /** @type {RawProfileExpectedView|null|undefined} */ (rawProfile);
  const normalizedId = normalizeLodgeId(profileView?.lodge_id);
  if (!isUuid(normalizedId)) return null;

  const createdAt = profileView?.created_at || new Date().toISOString();
  const status = profileView?.status === PROFILE_STATUS.DRAFT ? PROFILE_STATUS.DRAFT : PROFILE_STATUS.READY;
  const label = typeof profileView?.label === 'string' && profileView.label.trim() ?
  profileView.label.trim() :
  defaultUntitledLabel();

  return {
    lodge_id: /** @type {string} */ (normalizedId),
    label,
    status,
    created_at: createdAt,
    last_used_at: profileView?.last_used_at || createdAt
  };
}

/** @param {ProfileExpectedData[]} [profiles] @param {unknown} [activeLodgeId] @returns {ProfileExpectedData[]} */
function sortProfiles(profiles = [], activeLodgeId = null) {
  const activeId = normalizeLodgeId(activeLodgeId);
  return [...profiles].sort((a, b) => {
    if (a.lodge_id === activeId) return -1;
    if (b.lodge_id === activeId) return 1;
    if (a.status !== b.status) {
      return a.status === PROFILE_STATUS.READY ? -1 : 1;
    }
    return String(b.last_used_at || '').localeCompare(String(a.last_used_at || ''));
  });
}

/** @returns {ProfileRegistryExpectedData} */
export function readProfilesRegistry() {
  const raw = /** @type {RawProfileRegistryExpectedView|null|undefined} */ (readJsonFile(getProfilesPath(), null));
  const profiles = Array.isArray(raw?.profiles) ?
  raw.profiles.map(sanitizeProfile).filter((profile) => profile !== null) :
  [];
  const active = normalizeLodgeId(raw?.active_lodge_id);
  const activeExists = profiles.some((profile) => profile.lodge_id === active);

  return {
    active_lodge_id: activeExists ? active : null,
    profiles: sortProfiles(profiles, active)
  };
}

/** @param {ProfileRegistryInputExpectedView|null|undefined} registry @returns {ProfileRegistryExpectedData} */
export function writeProfilesRegistry(registry) {
  const activeId = normalizeLodgeId(registry?.active_lodge_id);
  const profiles = (Array.isArray(registry?.profiles) ? /** @type {unknown[]} */ (registry.profiles) : []).
  map(sanitizeProfile).
  filter((profile) => profile !== null);

  const next = {
    active_lodge_id: profiles.some((profile) => profile.lodge_id === activeId) ? activeId : null,
    profiles: sortProfiles(profiles, activeId)
  };

  writeJsonFile(getProfilesPath(), next);
  return next;
}

/** @param {ProfileSettingsExpectedView|null} [settings] @param {string|null|undefined} [fallback] @returns {string} */
export function profileLabelFromSettings(settings = {}, fallback) {
  const safeFallback = fallback || defaultUntitledLabel();
  return /** @type {string|null|undefined} */ (settings?.lodge_name)?.trim() || /** @type {string|null|undefined} */ (settings?.company_name)?.trim() || safeFallback;
}

/** @param {unknown} profileLodgeId */
export function ensureProfileCacheFiles(profileLodgeId) {
  const profileDir = getProfileCacheDir(profileLodgeId);
  ensureDir(profileDir);

  /** @type {[string, unknown][]} */
  const fileMap = [
  ['settings.json', []],
  ['users.json', []],
  ['rooms.json', []],
  ['room-types.json', []],
  ['floor-sections.json', []],
  ['customers.json', []],
  ['bookings.json', []],
  ['booking-charges.json', []],
  ['booking-refund-requests.json', []],
  ['booking-invoice-groups.json', []],
  ['booking-invoice-group-lines.json', []],
  ['room-rate-overrides.json', []],
  ['quotations.json', []],
  ['expenses.json', []],
  ['outlets.json', []],
  ['conference-bookings.json', []],
  ['event-line-items.json', []],
  ['customer-credit-ledger.json', []],
  ['customer-credit-summary.json', []],
  ['pool-day-use.json', []],
  ['inventory-items.json', []],
  ['inventory-purchases.json', []],
  ['inventory-movements.json', []],
  ['inventory-stocktakes.json', []],
  ['inventory-stocktake-lines.json', []],
  ['supply-items.json', []],
  ['supply-purchases.json', []],
  ['room-supply-stock.json', []],
  ['room-supply-movements.json', []],
  ['room-supply-allocations.json', []],
  ['supply-stocktakes.json', []],
  ['supply-stocktake-lines.json', []],
  ['room-supply-stocktakes.json', []],
  ['room-supply-stocktake-lines.json', []],
  ['pos-menu-items.json', []],
  ['pos-orders.json', []],
  ['pos-order-items.json', []],
  ['pos-void-history.json', []],
  ['pos-cashups.json', []],
  ['pos-tabs.json', []],
  ['pos-tables.json', []],
  ['pos-tickets.json', []],
  ['pos-shifts.json', []],
  ['pos-hardware-settings.json', []],
  ['pos-modifier-groups.json', []],
  ['pos-promotions.json', []],
  ['pos-floor-layout.json', []],
  ['pos-customer-display.json', null],
  ['pos-audit-log.json', []],
  ['corporate-accounts.json', []],
  ['rate-plans.json', []],
  ['room-move-log.json', []],
  ['group-blocks.json', []],
  ['master-folios.json', []],
  ['rooming-lists.json', []],
  ['payment-provider-configs.json', []],
  ['lost-found-items.json', []],
  ['incident-logs.json', []],
  ['visitor-registrations.json', []],
  ['linen-items.json', []],
  ['linen-laundry-batches.json', []],
  ['activity-log.json', []],
  ['auth-cache.json', []],
  ['sync-queue.json', []],
  ['sync-failed.json', []],
  ['sync-meta.json', null],
  ['health-faults.json', []],
  ['cache-freshness.json', null],
  ['trial_status.json', null]];


  for (const [fileName, fallback] of fileMap) {
    const filePath = path.join(profileDir, fileName);
    if (!fs.existsSync(filePath)) {
      writeJsonFile(filePath, fallback);
    }
  }
}

/** @returns {boolean} */
function hasLegacyCacheData() {
  const legacyFiles = [
  'settings.json',
  'users.json',
  'rooms.json',
  'customers.json',
  'bookings.json',
  'booking-charges.json',
  'booking-refund-requests.json',
  'booking-invoice-groups.json',
  'booking-invoice-group-lines.json',
  'room-rate-overrides.json',
  'quotations.json',
  'expenses.json',
  'outlets.json',
  'conference-bookings.json',
  'event-line-items.json',
  'customer-credit-ledger.json',
  'customer-credit-summary.json',
  'pool-day-use.json',
  'inventory-items.json',
  'inventory-purchases.json',
  'inventory-movements.json',
  'inventory-stocktakes.json',
  'inventory-stocktake-lines.json',
  'supply-items.json',
  'supply-purchases.json',
  'room-supply-stock.json',
  'room-supply-movements.json',
  'room-supply-allocations.json',
  'supply-stocktakes.json',
  'supply-stocktake-lines.json',
  'room-supply-stocktakes.json',
  'room-supply-stocktake-lines.json',
  'pos-menu-items.json',
  'pos-orders.json',
  'pos-order-items.json',
  'pos-void-history.json',
  'pos-cashups.json',
  'auth-cache.json',
  'sync-queue.json',
  'sync-failed.json',
  'activity-log.json',
  'session-nonce.json',
  'trial_status.json'];


  return legacyFiles.some((fileName) => fs.existsSync(path.join(/** @type {string} */ (state.cacheRootDir), fileName)));
}

/** @returns {ProfileRegistryExpectedData} */
function migrateLegacySingleLodgeProfile() {
  const legacyLodgeId = readLegacyLodgeId();
  if (!legacyLodgeId && !hasLegacyCacheData()) {
    return writeProfilesRegistry({ active_lodge_id: null, profiles: [] });
  }

  const derivedLodgeId = legacyLodgeId || randomUUID();
  const legacySettings = readJsonFile(path.join(/** @type {string} */ (state.cacheRootDir), 'settings.json'), []);
  const legacySettingsRow = /** @type {ProfileSettingsExpectedView|null|undefined} */ (Array.isArray(legacySettings) ? legacySettings[0] : null);
  // Existing migration flow assumes sanitizeProfile succeeds here. This view
  // records that expectation but does not guard invalid legacy IDs; the same
  // dereference failure remains if the existing assumption is violated.
  const profile = /** @type {ProfileExpectedData} */ (sanitizeProfile({
    lodge_id: derivedLodgeId,
    label: profileLabelFromSettings(legacySettingsRow, 'Existing Lodge'),
    status: legacySettingsRow?.setup_complete === false ? PROFILE_STATUS.DRAFT : PROFILE_STATUS.READY,
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString()
  }));

  const profileDir = getProfileCacheDir(profile.lodge_id);
  ensureDir(profileDir);

  const legacyFileNames = [
  'settings.json',
  'users.json',
  'rooms.json',
  'customers.json',
  'bookings.json',
  'booking-charges.json',
  'booking-refund-requests.json',
  'booking-invoice-groups.json',
  'booking-invoice-group-lines.json',
  'room-rate-overrides.json',
  'quotations.json',
  'expenses.json',
  'outlets.json',
  'conference-bookings.json',
  'event-line-items.json',
  'customer-credit-ledger.json',
  'customer-credit-summary.json',
  'pool-day-use.json',
  'inventory-items.json',
  'inventory-purchases.json',
  'inventory-movements.json',
  'inventory-stocktakes.json',
  'inventory-stocktake-lines.json',
  'supply-items.json',
  'supply-purchases.json',
  'room-supply-stock.json',
  'room-supply-movements.json',
  'room-supply-allocations.json',
  'supply-stocktakes.json',
  'supply-stocktake-lines.json',
  'room-supply-stocktakes.json',
  'room-supply-stocktake-lines.json',
  'pos-menu-items.json',
  'pos-orders.json',
  'pos-order-items.json',
  'pos-void-history.json',
  'pos-cashups.json',
  'auth-cache.json',
  'sync-queue.json',
  'sync-failed.json',
  'activity-log.json',
  'session-nonce.json',
  'trial_status.json'];


  for (const fileName of legacyFileNames) {
    const legacyPath = path.join(/** @type {string} */ (state.cacheRootDir), fileName);
    const nextPath = path.join(profileDir, fileName);
    if (fs.existsSync(legacyPath) && !fs.existsSync(nextPath)) {
      fs.copyFileSync(legacyPath, nextPath);
    }
  }

  persistLegacyLodgeId(profile.lodge_id);
  ensureProfileCacheFiles(profile.lodge_id);

  return writeProfilesRegistry({
    active_lodge_id: profile.lodge_id,
    profiles: [profile]
  });
}

/** @param {unknown} nextLodgeId @param {{persistActive?: unknown, touch?: unknown}} [options] */
export function setRuntimeActiveProfile(nextLodgeId, { persistActive = true, touch = true } = {}) {
  const normalizedId = normalizeLodgeId(nextLodgeId);
  state.lodgeId = normalizedId || null;
  state.cacheDir = state.lodgeId ? getProfileCacheDir(state.lodgeId) : getInactiveCacheDir();
  ensureDir(state.cacheDir);

  if (!persistActive) return;

  const registry = readProfilesRegistry();
  const nextProfiles = registry.profiles.map((profile) =>
  profile.lodge_id === normalizedId && touch ?
  { ...profile, last_used_at: new Date().toISOString() } :
  profile
  );

  writeProfilesRegistry({
    active_lodge_id: normalizedId,
    profiles: nextProfiles
  });
}

/** @returns {ProfileRegistryExpectedData} */
export function initializeProfileRuntime() {
  ensureDir(state.cacheRootDir);
  ensureDir(state.profilesCacheDir);
  ensureDir(getInactiveCacheDir());

  const registry = fs.existsSync(getProfilesPath()) ?
  writeProfilesRegistry(readProfilesRegistry()) :
  migrateLegacySingleLodgeProfile();

  const compatibleProfiles = registry.profiles.filter(isProfileCompatibleWithCurrentProduct);
  const activeLodgeId = compatibleProfiles.some((profile) => profile.lodge_id === registry.active_lodge_id) ?
  registry.active_lodge_id :
  compatibleProfiles[0]?.lodge_id || null;
  const productScopedRegistry = activeLodgeId === registry.active_lodge_id ? registry :
  writeProfilesRegistry({ ...registry, active_lodge_id: activeLodgeId });

  setRuntimeActiveProfile(productScopedRegistry.active_lodge_id, { persistActive: false, touch: false });
  return productScopedRegistry;
}

/** @param {unknown} targetLodgeId @param {Record<string, unknown>} [updates] */
export function updateProfileMetadata(targetLodgeId, updates = {}) {
  const normalizedId = normalizeLodgeId(targetLodgeId);
  const registry = readProfilesRegistry();
  const nextProfiles = registry.profiles.map((profile) => {
    if (profile.lodge_id !== normalizedId) return profile;
    return sanitizeProfile({
      ...profile,
      ...updates,
      lodge_id: updates.lodge_id || profile.lodge_id,
      last_used_at: updates.last_used_at || new Date().toISOString()
    });
  }).filter(Boolean);

  return writeProfilesRegistry({
    active_lodge_id: normalizeLodgeId(updates.lodge_id || registry.active_lodge_id),
    profiles: nextProfiles
  });
}

/** @param {unknown} targetLodgeId */
export function removeLocalCompanyProfile(targetLodgeId) {
  const normalizedId = normalizeLodgeId(targetLodgeId);
  if (!normalizedId) return { removed: false, active_profile: getActiveProfile(), profiles: getProfiles() };

  const registry = readProfilesRegistry();
  const profileCacheDir = getProfileCacheDir(normalizedId);
  try {fs.rmSync(profileCacheDir, { recursive: true, force: true });} catch {}

  const remainingProfiles = registry.profiles.filter((entry) => entry.lodge_id !== normalizedId);
  const nextActiveId = registry.active_lodge_id === normalizedId ?
  remainingProfiles[0]?.lodge_id || null :
  registry.active_lodge_id;

  writeProfilesRegistry({
    active_lodge_id: nextActiveId,
    profiles: remainingProfiles
  });

  if (readLegacyLodgeId() === normalizedId) {
    persistLegacyLodgeId(nextActiveId);
  }

  if (state.lodgeId === normalizedId) {
    state.currentUser = null;
    state.replayAuthReady = false;
    clearBackendSession();
    setRuntimeActiveProfile(nextActiveId, { persistActive: false, touch: false });
  }

  return {
    removed: registry.profiles.some((entry) => entry.lodge_id === normalizedId),
    active_profile: getActiveProfile(),
    profiles: getProfiles()
  };
}

/** @returns {ProfileListItemExpectedData[]} */
export function getProfiles() {
  const registry = readProfilesRegistry();
  return registry.profiles.map((profile) => ({
    ...profile,
    active: profile.lodge_id === registry.active_lodge_id
  }));
}

/** @returns {ProfileExpectedData|null} */
export function getActiveProfile() {
  const registry = readProfilesRegistry();
  const active = registry.profiles.find((profile) => profile.lodge_id === registry.active_lodge_id);
  return active || null;
}

/** @param {unknown} lodgeId @param {{label?: unknown}} [options] */
export function ensureReadyProfileForLodge(lodgeId, { label } = {}) {
  const normalizedId = normalizeLodgeId(lodgeId);
  if (!isUuid(normalizedId)) throw new Error('The server returned an invalid lodge ID.');

  const registry = readProfilesRegistry();
  const nextLabel = typeof label === 'string' && label.trim() ? label.trim() : `Existing ${productBusinessTitle()}`;
  const existing = registry.profiles.find((profile) => profile.lodge_id === normalizedId);
  const genericLabels = new Set(['Untitled Lodge', 'New Lodge', defaultUntitledLabel(), defaultDraftLabel()]);
  // `normalizedId` passed isUuid above; this expected view adds no runtime check.
  const nextProfile = /** @type {ProfileExpectedData} */ (sanitizeProfile({
    ...(existing || {}),
    lodge_id: normalizedId,
    label: existing?.label && !genericLabels.has(existing.label) ? existing.label : nextLabel,
    status: PROFILE_STATUS.READY,
    created_at: existing?.created_at || new Date().toISOString(),
    last_used_at: new Date().toISOString()
  }));
  const remainingProfiles = registry.profiles.filter((profile) => profile.lodge_id !== normalizedId);

  writeProfilesRegistry({
    active_lodge_id: normalizedId,
    profiles: [nextProfile, ...remainingProfiles]
  });
  persistLegacyLodgeId(normalizedId);
  ensureProfileCacheFiles(normalizedId);
  setRuntimeActiveProfile(normalizedId, { persistActive: false, touch: false });
  return getActiveProfile();
}

/** @returns {ProfileSettingsExpectedView} */
function getCachedSettingsSnapshot() {
  if (!state.cacheDir) {
    return {
      lodge_id: state.lodgeId || null
    };
  }
  const cached = /** @type {unknown[]} */ (readJsonFile(path.join(state.cacheDir, 'settings.json'), []));
  return /** @type {ProfileSettingsExpectedView} */ (cached[0]) || {
    lodge_id: state.lodgeId || null
  };
}

/** @param {unknown} targetLodgeId */
export async function selectProfile(targetLodgeId) {
  const normalizedId = normalizeLodgeId(targetLodgeId);
  const registry = readProfilesRegistry();
  const profile = registry.profiles.find((entry) => entry.lodge_id === normalizedId);
  if (!profile) throw new Error('That lodge profile was not found on this computer.');
  if (!isProfileCompatibleWithCurrentProduct(profile)) {
    const cached = readJsonFile(path.join(getProfileCacheDir(profile.lodge_id), 'settings.json'), []);
    const settings = /** @type {ProfileSettingsExpectedView|null|undefined} */ (Array.isArray(cached) ? cached[0] : cached);
    throw productMismatchError(settings?.property_type || settings?.business_type || '');
  }

  // Shut down any active P2P mesh before changing profiles
  try {
    const meshLifecycle = await import('./mesh/meshLifecycle.js');
    meshLifecycle.shutdownMesh();
  } catch (err) {
    console.error('[Mesh] Failed to shutdown mesh during profile selection:', err);
  }

  state.currentUser = null;
  state.replayAuthReady = false;
  clearBackendSession();
  setRuntimeActiveProfile(normalizedId, { persistActive: true, touch: true });
  ensureProfileCacheFiles(normalizedId);

  if (state.cacheDir) {
    const meta = readSyncMeta();
    state.lastSuccessfulSyncAt = meta.lastSuccessfulSyncAt || null;
  }

  await checkOnline();
  if (state.isOnline) {
    await refreshAllCaches();
  }

  // The target profile was found in the registry above and is now active. This
  // expected-data assertion does not validate the returned profile.
  return {
    .../** @type {ProfileExpectedData} */ (getActiveProfile()),
    settings: getCachedSettingsSnapshot()
  };
}

/** @returns {Promise<ProfileExpectedData>} */
export async function createDraftProfile() {
  const draftLodgeId = randomUUID();
  // randomUUID supplies the UUID checked by sanitizeProfile; assertion is erased.
  const draftProfile = /** @type {ProfileExpectedData} */ (sanitizeProfile({
    lodge_id: draftLodgeId,
    label: defaultDraftLabel(),
    status: PROFILE_STATUS.DRAFT,
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString()
  }));

  const registry = readProfilesRegistry();
  const nextProfiles = registry.profiles.filter((profile) => profile.lodge_id !== draftLodgeId);
  nextProfiles.unshift(draftProfile);
  writeProfilesRegistry({
    active_lodge_id: draftLodgeId,
    profiles: nextProfiles
  });

  // A new company must never inherit the previous company's operator or
  // replay authority, even when draft creation is invoked outside the UI.
  state.currentUser = null;
  state.replayAuthReady = false;
  clearBackendSession();
  setRuntimeActiveProfile(draftLodgeId, { persistActive: false, touch: false });
  ensureProfileCacheFiles(draftLodgeId);
  clearCache('users');
  clearCache('rooms');
  clearCache('customers');
  clearCache('bookings');
  clearCache('quotations');
  clearCache('settings');
  clearCache('trial_status', null);
  clearActivityLog();
  writeAuthCache([]);
  writeSyncQueue([]);
  writeFailedSyncQueue([]);
  clearBackendSession();
  clearSessionNonce();

  return draftProfile;
}

/** @param {unknown} targetLodgeId @returns {Promise<Extract<import('../../shared/desktopIpcContracts.js').DesktopProfileRemoveDraftResult, {success: true}>>} */
export async function removeDraftProfile(targetLodgeId) {
  const normalizedId = normalizeLodgeId(targetLodgeId);
  const registry = readProfilesRegistry();
  const profile = registry.profiles.find((entry) => entry.lodge_id === normalizedId);
  if (!profile) throw new Error('That lodge profile was not found on this computer.');
  if (profile.status !== PROFILE_STATUS.DRAFT) {
    throw new Error('Only incomplete draft lodge profiles can be removed.');
  }

  const draftCacheDir = getProfileCacheDir(normalizedId);
  const draftQueue = readJsonFile(path.join(draftCacheDir, 'sync-queue.json'), []);
  if (Array.isArray(draftQueue) && draftQueue.length > 0) {
    const err = new Error(`This draft lodge has ${draftQueue.length} unsynced offline change(s).`);
    err.code = 'draft_profile_blocked_by_unsynced_changes';
    throw err;
  }

  await checkOnline();
  if (state.isOnline) {
    const { data: remoteSettings } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).
    from('settings').
    select('setup_complete').
    eq('lodge_id', normalizedId).
    maybeSingle();

    if (remoteSettings?.setup_complete === true) {
      const err = new Error('This lodge profile is already linked to a completed company in Supabase and cannot be removed as a draft.');
      err.code = 'remote_lodge_already_exists';
      throw err;
    }
  }

  try {fs.rmSync(draftCacheDir, { recursive: true, force: true });} catch {}

  const remainingProfiles = registry.profiles.filter((entry) => entry.lodge_id !== normalizedId);
  const nextActiveId = registry.active_lodge_id === normalizedId ?
  remainingProfiles[0]?.lodge_id || null :
  registry.active_lodge_id;

  writeProfilesRegistry({
    active_lodge_id: nextActiveId,
    profiles: remainingProfiles
  });

  state.currentUser = null;
  clearBackendSession();
  setRuntimeActiveProfile(nextActiveId, { persistActive: false, touch: false });
  if (nextActiveId && state.isOnline) {
    await refreshAllCaches();
  }

  return {
    success: true,
    active_profile: getActiveProfile(),
    profiles: getProfiles()
  };
}
