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

export const PROFILE_STATUS = {
  DRAFT: 'draft',
  READY: 'ready'
}

function getLodgeIdPath() {
  return path.join(app.getPath('userData'), 'lodge-id.json');
}

function getProfilesPath() {
  return path.join(app.getPath('userData'), 'profiles.json');
}

function readLegacyLodgeId() {
  const data = readJsonFile(getLodgeIdPath(), null);
  return normalizeLodgeId(data?.lodge_id);
}

export function persistLegacyLodgeId(id) {
  writeJsonFile(getLodgeIdPath(), { lodge_id: id });
}

export function getProfileCacheDir(profileLodgeId) {
  return path.join(state.profilesCacheDir, normalizeLodgeId(profileLodgeId));
}

function getInactiveCacheDir() {
  return path.join(state.cacheRootDir, '__inactive');
}

export function sanitizeProfile(rawProfile) {
  const normalizedId = normalizeLodgeId(rawProfile?.lodge_id);
  if (!isUuid(normalizedId)) return null;

  const createdAt = rawProfile?.created_at || new Date().toISOString();
  const status = rawProfile?.status === PROFILE_STATUS.DRAFT ? PROFILE_STATUS.DRAFT : PROFILE_STATUS.READY;
  const label = typeof rawProfile?.label === 'string' && rawProfile.label.trim() ?
  rawProfile.label.trim() :
  'Untitled Lodge';

  return {
    lodge_id: normalizedId,
    label,
    status,
    created_at: createdAt,
    last_used_at: rawProfile?.last_used_at || createdAt
  };
}

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

export function readProfilesRegistry() {
  const raw = readJsonFile(getProfilesPath(), null);
  const profiles = Array.isArray(raw?.profiles) ?
  raw.profiles.map(sanitizeProfile).filter(Boolean) :
  [];
  const active = normalizeLodgeId(raw?.active_lodge_id);
  const activeExists = profiles.some((profile) => profile.lodge_id === active);

  return {
    active_lodge_id: activeExists ? active : null,
    profiles: sortProfiles(profiles, active)
  };
}

export function writeProfilesRegistry(registry) {
  const activeId = normalizeLodgeId(registry?.active_lodge_id);
  const profiles = (Array.isArray(registry?.profiles) ? registry.profiles : []).
  map(sanitizeProfile).
  filter(Boolean);

  const next = {
    active_lodge_id: profiles.some((profile) => profile.lodge_id === activeId) ? activeId : null,
    profiles: sortProfiles(profiles, activeId)
  };

  writeJsonFile(getProfilesPath(), next);
  return next;
}

export function profileLabelFromSettings(settings = {}, fallback = 'Untitled Lodge') {
  return settings?.lodge_name?.trim() || settings?.company_name?.trim() || fallback;
}

export function ensureProfileCacheFiles(profileLodgeId) {
  const profileDir = getProfileCacheDir(profileLodgeId);
  ensureDir(profileDir);

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


  return legacyFiles.some((fileName) => fs.existsSync(path.join(state.cacheRootDir, fileName)));
}

function migrateLegacySingleLodgeProfile() {
  const legacyLodgeId = readLegacyLodgeId();
  if (!legacyLodgeId && !hasLegacyCacheData()) {
    return writeProfilesRegistry({ active_lodge_id: null, profiles: [] });
  }

  const derivedLodgeId = legacyLodgeId || randomUUID();
  const legacySettings = readJsonFile(path.join(state.cacheRootDir, 'settings.json'), []);
  const legacySettingsRow = Array.isArray(legacySettings) ? legacySettings[0] : null;
  const profile = sanitizeProfile({
    lodge_id: derivedLodgeId,
    label: profileLabelFromSettings(legacySettingsRow, 'Existing Lodge'),
    status: legacySettingsRow?.setup_complete === false ? PROFILE_STATUS.DRAFT : PROFILE_STATUS.READY,
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString()
  });

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
    const legacyPath = path.join(state.cacheRootDir, fileName);
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

export function initializeProfileRuntime() {
  ensureDir(state.cacheRootDir);
  ensureDir(state.profilesCacheDir);
  ensureDir(getInactiveCacheDir());

  const registry = fs.existsSync(getProfilesPath()) ?
  writeProfilesRegistry(readProfilesRegistry()) :
  migrateLegacySingleLodgeProfile();

  setRuntimeActiveProfile(registry.active_lodge_id, { persistActive: false, touch: false });
  return registry;
}

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

export function getProfiles() {
  const registry = readProfilesRegistry();
  return registry.profiles.map((profile) => ({
    ...profile,
    active: profile.lodge_id === registry.active_lodge_id
  }));
}

export function getActiveProfile() {
  const registry = readProfilesRegistry();
  const active = registry.profiles.find((profile) => profile.lodge_id === registry.active_lodge_id);
  return active || null;
}

export function ensureReadyProfileForLodge(lodgeId, { label = 'Existing Lodge' } = {}) {
  const normalizedId = normalizeLodgeId(lodgeId);
  if (!isUuid(normalizedId)) throw new Error('The server returned an invalid lodge ID.');

  const registry = readProfilesRegistry();
  const nextLabel = typeof label === 'string' && label.trim() ? label.trim() : 'Existing Lodge';
  const existing = registry.profiles.find((profile) => profile.lodge_id === normalizedId);
  const nextProfile = sanitizeProfile({
    ...(existing || {}),
    lodge_id: normalizedId,
    label: existing?.label && existing.label !== 'Untitled Lodge' ? existing.label : nextLabel,
    status: PROFILE_STATUS.READY,
    created_at: existing?.created_at || new Date().toISOString(),
    last_used_at: new Date().toISOString()
  });
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

function getCachedSettingsSnapshot() {
  if (!state.cacheDir) {
    return {
      lodge_id: state.lodgeId || null
    };
  }
  const cached = readJsonFile(path.join(state.cacheDir, 'settings.json'), []);
  return cached[0] || {
    lodge_id: state.lodgeId || null
  };
}

export async function selectProfile(targetLodgeId) {
  const normalizedId = normalizeLodgeId(targetLodgeId);
  const registry = readProfilesRegistry();
  const profile = registry.profiles.find((entry) => entry.lodge_id === normalizedId);
  if (!profile) throw new Error('That lodge profile was not found on this computer.');

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

  return {
    ...getActiveProfile(),
    settings: getCachedSettingsSnapshot()
  };
}

export async function createDraftProfile() {
  const draftLodgeId = randomUUID();
  const draftProfile = sanitizeProfile({
    lodge_id: draftLodgeId,
    label: 'New Lodge',
    status: PROFILE_STATUS.DRAFT,
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString()
  });

  const registry = readProfilesRegistry();
  const nextProfiles = registry.profiles.filter((profile) => profile.lodge_id !== draftLodgeId);
  nextProfiles.unshift(draftProfile);
  writeProfilesRegistry({
    active_lodge_id: draftLodgeId,
    profiles: nextProfiles
  });

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
    const { data: remoteSettings } = await state.supabase.
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
