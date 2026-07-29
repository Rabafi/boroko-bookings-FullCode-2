import { randomUUID } from 'crypto';
import fs from 'fs';
import {
  mergeOperatingProfileWithLockedHospitalityMode,
  propertyTypeToBusinessType,
  resolveLockedPropertyType
} from '../../shared/propertyTypes.js';
import { state } from '../state.js';
import { readAuthCache, upsertCachedUser, writeAuthCache } from './authCache.js';
import {
  clearActivityLog
} from './misc.js';
import {
  createAppError,
  isBackendAuthSchemaError,
  isUuid,
  normalizeEmail,
  normalizeLodgeId
} from './shared.js';
import {
  clearBackendSession,
  clearCache,
  clearSessionNonce,
  createUser,
  ensureDir,
  readCache,
  readSyncQueue,
  refreshAllCaches,
  runAuthHealthCheck,
  writeCache,
  writeSyncQueue
} from './infrastructure.js';
import { checkOnline } from './connectivity.js';
import {
  PROFILE_STATUS,
  ensureProfileCacheFiles,
  getActiveProfile,
  getProfileCacheDir,
  getProfiles,
  persistLegacyLodgeId,
  profileLabelFromSettings,
  readProfilesRegistry,
  sanitizeProfile,
  setRuntimeActiveProfile,
  updateProfileMetadata,
  writeProfilesRegistry
} from './profiles.js';

const DEFAULT_SETTINGS = {
  lodge_name: '',
  company_name: '',
  address: '',
  city: '',
  country: 'Botswana',
  phone: '',
  email: '',
  website: '',
  vat_number: '',
  vat_enabled: false,
  vat_rate: 0,
  currency: 'P',
  logo: '',
  business_type: 'lodge',
  property_type: 'lodge',
  assistant_enabled: false,
  setup_complete: false,
  operating_profile: {}
};
const SETTINGS_QUERY_TIMEOUT_MS = 15000;
const SETTINGS_BACKGROUND_REFRESH_TIMEOUT_MS = 10000;
let settingsRefreshInFlight = null;

function getDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    lodge_id: state.lodgeId || null
  };
}

async function getRemoteSettingsRecord(targetLodgeId = state.lodgeId) {
  const queryPromise = state.supabase.from('settings').select('*').eq('lodge_id', targetLodgeId).maybeSingle();
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('settings query timeout')), SETTINGS_QUERY_TIMEOUT_MS));
  let result = await Promise.race([queryPromise, timeoutPromise]);
  if (!result.error) {
    return { data: result.data, mode: 'lodge' };
  }
  if (!/column .*lodge_id/i.test(result.error.message || '')) {
    throw new Error(result.error.message);
  }
  const err = new Error('The Supabase settings table is missing the required lodge_id UUID contract. Apply the current settings migration, then try again.');
  err.code = 'backend_auth_schema_outdated';
  throw err;
}

function normalizeSettingsRow(row = {}) {
  return {
    ...row,
    lodge_id: row.lodge_id || state.lodgeId || null
  };
}

function getCachedSettings() {
  const cached = readCache('settings');
  return cached[0] ? normalizeSettingsRow(cached[0]) : null;
}

function refreshSettingsCacheInBackground() {
  if (!state.isOnline || !state.lodgeId || settingsRefreshInFlight) return;
  settingsRefreshInFlight = (async () => {
    try {
      const queryPromise = getRemoteSettingsRecord();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('settings background refresh timeout')), SETTINGS_BACKGROUND_REFRESH_TIMEOUT_MS)
      );
      const { data } = await Promise.race([queryPromise, timeoutPromise]);
      if (!data) return;
      const normalized = normalizeSettingsRow(data);
      writeCache('settings', [normalized]);
      const activeProfile = getActiveProfile();
      if (activeProfile?.status === PROFILE_STATUS.READY) {
        updateProfileMetadata(state.lodgeId, { label: profileLabelFromSettings(normalized, activeProfile.label) });
      }
    } catch (error) {
      console.warn('[SETTINGS] background refresh delayed:', error?.message || error);
    } finally {
      settingsRefreshInFlight = null;
    }
  })();
}

function isRowLevelSecurityError(message = '') {
  return /row-level security|violates row-level security|permission denied for table settings/i.test(String(message || ''));
}

/**
 * First-time company setup cannot use direct settings INSERT under RLS because
 * app_lodge_access requires an existing lodge session/user. Prefer service-role
 * admin client when available, otherwise the security-definer bootstrap RPC.
 */
async function bootstrapRemoteSettingsRecord(settings) {
  if (state.adminDb) {
    const result = await state.adminDb.from('settings').upsert(settings, { onConflict: 'lodge_id' }).select().maybeSingle();
    if (!result.error) {
      return { data: { ...settings, ...(result.data || {}) }, mode: 'service_role_bootstrap' };
    }
    if (!isRowLevelSecurityError(result.error.message || '')) {
      // Fall through to RPC for schema/RLS-independent bootstrap.
      console.warn('[SETUP] adminDb settings upsert failed, trying bootstrap RPC:', result.error.message);
    }
  }

  const { data, error } = await state.supabase.rpc('bootstrap_company_settings', {
    p_payload: settings
  });
  if (error) {
    const message = error.message || 'Could not bootstrap company settings.';
    if (/function .*bootstrap_company_settings|could not find the function/i.test(message)) {
      const err = new Error(
        'This database is missing the company setup bootstrap function. Apply migration 20260712120000_bootstrap_company_settings.sql, then retry setup.'
      );
      err.code = 'backend_auth_schema_outdated';
      throw err;
    }
    throw new Error(message);
  }
  if (!data?.success) {
    const err = new Error(data?.error || 'Could not bootstrap company settings.');
    err.code = data?.code || 'settings_bootstrap_failed';
    throw err;
  }
  return {
    data: { ...settings, ...(data.settings || {}), lodge_id: settings.lodge_id },
    mode: 'rpc_bootstrap'
  };
}

async function saveRemoteSettingsRecord(settings, { allowBootstrap = false } = {}) {
  const optionalRemoteColumns = new Set([
    'assistant_enabled',
    'slug',
    'booking_tagline',
    'booking_description',
    'hero_image',
    'whatsapp_number',
    'booking_check_in_from',
    'booking_check_out_until',
    'booking_cancellation_policy',
    'booking_payment_terms',
    'booking_house_rules',
    'booking_faq',
    'public_offer_rooms',
    'public_offer_multi_room',
    'public_offer_full_lodge',
    'public_offer_day_use',
    'public_offer_events',
    'property_type',
    'operating_profile'
  ]);
  const remoteSettings = { ...settings };
  const skippedColumns = [];
  let lastErrorMessage = '';

  for (let attempt = 0; attempt <= optionalRemoteColumns.size; attempt += 1) {
    const result = await state.supabase.from('settings').upsert(remoteSettings, { onConflict: 'lodge_id' }).select().maybeSingle();
    if (!result.error) {
      return { data: { ...settings, ...(result.data || {}) }, mode: 'lodge', skippedColumns };
    }

    const message = result.error.message || '';
    lastErrorMessage = message;
    const missingColumn = [...optionalRemoteColumns].find((column) => new RegExp(`'${column}'|\\b${column}\\b`, 'i').test(message));
    if (missingColumn) {
      delete remoteSettings[missingColumn];
      optionalRemoteColumns.delete(missingColumn);
      skippedColumns.push(missingColumn);
      continue;
    }

    // New company setup has no lodge session yet — RLS blocks direct insert/update.
    if (allowBootstrap && isRowLevelSecurityError(message)) {
      return bootstrapRemoteSettingsRecord(remoteSettings);
    }

    if (!/column .*lodge_id|constraint|on conflict/i.test(message)) {
      throw new Error(message);
    }
    const err = new Error('The Supabase settings table is missing the required lodge_id UUID contract. Apply the current settings migration, then try again.');
    err.code = 'backend_auth_schema_outdated';
    throw err;
  }

  if (allowBootstrap && isRowLevelSecurityError(lastErrorMessage)) {
    return bootstrapRemoteSettingsRecord(remoteSettings);
  }

  throw new Error('Settings could not be saved because the remote settings table is missing too many expected columns.');
}

export async function getSettings() {
  if (!state.lodgeId) {
    return getDefaultSettings();
  }
  const cachedSettings = getCachedSettings();
  if (cachedSettings) {
    refreshSettingsCacheInBackground();
    return cachedSettings;
  }
  if (state.isOnline) {
    try {
      const { data } = await getRemoteSettingsRecord();
      if (data) {
        const normalized = normalizeSettingsRow(data);
        writeCache('settings', [normalized]);
        return normalized;
      }
    } catch (e) {
      console.warn('[SETTINGS] load delayed; using defaults until cache is available:', e.message);
    }
  }
  return getDefaultSettings();
}

export async function getLodgeDiagnostics(expectedLodgeId = '') {
  await checkOnline();
  const expected = normalizeLodgeId(expectedLodgeId);
  const queue = readSyncQueue();
  const authEntries = readAuthCache().filter((entry) => entry.lodge_id === state.lodgeId);
  const users = readCache('users').filter((entry) => !entry.lodge_id || entry.lodge_id === state.lodgeId);
  let remoteSettings = null;
  let expectedSettings = null;
  const activeProfile = getActiveProfile();

  if (state.isOnline && state.lodgeId) {
    const { data } = await state.supabase.from('settings').select('lodge_id, lodge_name, company_name, setup_complete, updated_at').eq('lodge_id', state.lodgeId).maybeSingle();
    remoteSettings = data || null;
    if (expected) {
      const { data: match } = await state.supabase.from('settings').select('lodge_id, lodge_name, company_name, setup_complete, updated_at').eq('lodge_id', expected).maybeSingle();
      expectedSettings = match || null;
    }
  }

  return {
    online: state.isOnline,
    active_profile: activeProfile,
    profile_count: getProfiles().length,
    current_lodge_id: state.lodgeId,
    expected_lodge_id: expected || null,
    expected_matches_current: expected ? expected === state.lodgeId : null,
    unsynced_operations: queue.length,
    cached_user_count: users.length,
    cached_offline_login_count: authEntries.length,
    current_lodge_exists_remotely: !!remoteSettings,
    expected_lodge_exists_remotely: expected ? !!expectedSettings : null,
    remote_settings: remoteSettings,
    expected_settings: expectedSettings
  };
}

export async function relinkLodge(expectedLodgeId) {
  const nextLodgeId = normalizeLodgeId(expectedLodgeId);
  if (!nextLodgeId) throw new Error('Enter the correct lodge ID first.');
  if (!isUuid(nextLodgeId)) throw new Error('Lodge ID format looks invalid.');

  const activeProfile = getActiveProfile();
  if (!activeProfile) throw new Error('Choose a lodge profile on this computer before repairing it.');

  await checkOnline();
  const queue = readSyncQueue();
  if (queue.length > 0) {
    const err = new Error(`This lodge profile has ${queue.length} unsynced offline change(s). Sync them before relinking it.`);
    err.code = 'draft_profile_blocked_by_unsynced_changes';
    throw err;
  }

  if (state.isOnline) {
    const { data } = await state.supabase.
    from('settings').
    select('lodge_id, lodge_name, company_name, setup_complete').
    eq('lodge_id', nextLodgeId).
    maybeSingle();
    if (!data) throw new Error('That lodge ID was not found in Supabase.');
  }

  const existingTarget = getProfiles().find((profile) => profile.lodge_id === nextLodgeId && profile.lodge_id !== activeProfile.lodge_id);
  if (existingTarget) {
    throw new Error('That lodge is already saved on this computer. Switch to it from the Lodge Chooser instead of relinking this profile.');
  }

  const previousLodgeId = activeProfile.lodge_id;
  const previousDir = getProfileCacheDir(previousLodgeId);
  const nextDir = getProfileCacheDir(nextLodgeId);

  try {
    if (fs.existsSync(previousDir) && previousDir !== nextDir) {
      fs.rmSync(nextDir, { recursive: true, force: true });
      fs.renameSync(previousDir, nextDir);
    }
  } catch {
    ensureDir(nextDir);
  }

  ensureProfileCacheFiles(nextLodgeId);
  persistLegacyLodgeId(nextLodgeId);

  updateProfileMetadata(previousLodgeId, {
    lodge_id: nextLodgeId,
    label: activeProfile.label,
    status: activeProfile.status
  });

  setRuntimeActiveProfile(nextLodgeId, { persistActive: true, touch: true });
  state.currentUser = null;

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

  if (state.isOnline) {
    await refreshAllCaches();
  }

  return {
    success: true,
    lodge_id: state.lodgeId,
    settings: await getSettings(),
    diagnostics: await getLodgeDiagnostics(state.lodgeId)
  };
}

export function resetToNewLodge() {
  const draftProfile = sanitizeProfile({
    lodge_id: randomUUID(),
    label: 'New Lodge',
    status: PROFILE_STATUS.DRAFT,
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString()
  });

  const registry = readProfilesRegistry();
  const nextProfiles = registry.profiles.filter((profile) => profile.lodge_id !== draftProfile.lodge_id);
  nextProfiles.unshift(draftProfile);
  writeProfilesRegistry({
    active_lodge_id: draftProfile.lodge_id,
    profiles: nextProfiles
  });

  setRuntimeActiveProfile(draftProfile.lodge_id, { persistActive: false, touch: false });
  ensureProfileCacheFiles(draftProfile.lodge_id);
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
  return draftProfile.lodge_id;
}

export async function saveSettings(data, options = {}) {
  if (!state.lodgeId) throw new Error('Choose a lodge profile on this computer before saving settings.');
  const allowBootstrap = options?.allowBootstrap === true;
  // hospitality_mode is a commercial product choice (restaurant vs bar pricing).
  // Once set, never let client Settings patches switch it.
  const existingSettings = getCachedSettings() || getDefaultSettings() || {};
  const lockedOperatingProfile = mergeOperatingProfileWithLockedHospitalityMode(
    data.operating_profile || {},
    existingSettings.operating_profile || {}
  );
  // Property type is chosen at setup / by product app. After setup_complete,
  // Settings must not reclassify lodge ↔ hotel ↔ restaurant.
  const lockedPropertyType = resolveLockedPropertyType(data, existingSettings);

  const settings = {
    lodge_name: data.lodge_name || '',
    company_name: data.company_name || '',
    address: data.address || '',
    city: data.city || '',
    country: data.country || 'Botswana',
    phone: data.phone || '',
    email: data.email || '',
    website: data.website || '',
    vat_number: data.vat_number || '',
    vat_enabled: data.vat_enabled ?? false,
    vat_rate: Number(data.vat_rate || 0),
    currency: data.currency || 'P',
    logo: data.logo || '',
    business_type: propertyTypeToBusinessType(lockedPropertyType),
    property_type: lockedPropertyType,
    assistant_enabled: data.assistant_enabled === true,
    slug: data.slug ? data.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') : null,
    booking_tagline: data.booking_tagline || '',
    booking_description: data.booking_description || '',
    hero_image: data.hero_image || '',
    whatsapp_number: data.whatsapp_number || '',
    booking_check_in_from: data.booking_check_in_from || '',
    booking_check_out_until: data.booking_check_out_until || '',
    booking_cancellation_policy: data.booking_cancellation_policy || '',
    booking_payment_terms: data.booking_payment_terms || '',
    booking_house_rules: data.booking_house_rules || '',
    booking_faq: Array.isArray(data.booking_faq) ? data.booking_faq : [],
    public_offer_rooms: data.public_offer_rooms !== false,
    public_offer_multi_room: data.public_offer_multi_room !== false,
    public_offer_full_lodge: data.public_offer_full_lodge === true,
    public_offer_day_use: data.public_offer_day_use === true,
    public_offer_events: data.public_offer_events === true,
    operating_profile: lockedOperatingProfile,
    setup_complete: true,
    updated_at: new Date().toISOString(),
    lodge_id: state.lodgeId
  };

  if (state.isOnline) {
    const saved = await saveRemoteSettingsRecord(settings, { allowBootstrap });
    const savedRemote = saved?.data || null;
    const usedBootstrap = saved?.mode === 'rpc_bootstrap' || saved?.mode === 'service_role_bootstrap';

    // Bootstrap path already stamps trial_started_at. Direct updates still need
    // lodge access and will RLS-fail before the first admin user exists.
    if (!usedBootstrap) {
      const { error } = await state.supabase.from('settings').
      update({ trial_started_at: new Date().toISOString() }).
      eq('lodge_id', state.lodgeId).
      is('trial_started_at', null);
      if (error && !/column .*trial_started_at/i.test(error.message || '') && !isRowLevelSecurityError(error.message || '')) {
        throw new Error(error.message);
      }
    }

    const normalized = savedRemote ? { ...settings, ...savedRemote, lodge_id: state.lodgeId } : settings;
    writeCache('settings', [normalized]);
    const activeProfile = getActiveProfile();
    if (activeProfile?.status === PROFILE_STATUS.READY) {
      updateProfileMetadata(state.lodgeId, { label: profileLabelFromSettings(normalized, activeProfile.label) });
    }
    return normalized;
  }
  writeCache('settings', [settings]);
  const activeProfile = getActiveProfile();
  if (activeProfile?.status === PROFILE_STATUS.READY) {
    updateProfileMetadata(state.lodgeId, { label: profileLabelFromSettings(settings, activeProfile.label) });
  }
  return settings;
}

export async function updateOperatingProfile(profile) {
  if (!state.lodgeId) throw new Error('Choose a lodge profile on this computer before saving operating profile.');

  const current = getCachedSettings() || getDefaultSettings();
  // First-time setup may set hospitality_mode; later patches cannot switch priced products.
  const lockedProfile = mergeOperatingProfileWithLockedHospitalityMode(
    profile || {},
    current.operating_profile || {}
  );
  const updated = { ...current, operating_profile: lockedProfile, updated_at: new Date().toISOString() };

  writeCache('settings', [updated]);

  if (state.isOnline) {
    try {
      await state.supabase.from('settings').upsert(
        { lodge_id: state.lodgeId, operating_profile: lockedProfile, updated_at: new Date().toISOString() },
        { onConflict: 'lodge_id' }
      );
    } catch (e) {
      console.warn('[SETTINGS] Failed to save operating profile to remote:', e.message);
    }
  }
  return updated;
}

export async function initializeCompanySetup({ settings, admin }) {
  const activeProfile = getActiveProfile();
  if (!activeProfile) {
    throw createAppError('no_draft_profile_selected', 'Create a new lodge profile on this computer before running setup.');
  }
  if (activeProfile.status !== PROFILE_STATUS.DRAFT) {
    throw createAppError('profile_already_ready', 'This lodge profile is already set up. Switch profiles or use Settings to change its details.', {
      lodge_id: activeProfile.lodge_id
    });
  }

  await checkOnline();
  if (!state.isOnline) {
    throw new Error('An internet connection is required to complete setup.');
  }

  const queue = readSyncQueue();
  if (queue.length > 0) {
    throw createAppError(
      'draft_profile_blocked_by_unsynced_changes',
      `This draft lodge profile has ${queue.length} unsynced offline change(s). Clear or sync them before completing setup.`,
      { lodge_id: state.lodgeId, pending_operations: queue.length }
    );
  }

  const { data: remoteSettings } = await state.supabase.
  from('settings').
  select('setup_complete, lodge_name, company_name').
  eq('lodge_id', state.lodgeId).
  maybeSingle();
  if (remoteSettings?.setup_complete === true) {
    throw createAppError(
      'remote_lodge_already_exists',
      'This draft lodge profile is already linked to a completed company in Supabase. Switch to that lodge instead of running setup again.',
      { lodge_id: state.lodgeId, remote_settings: remoteSettings }
    );
  }

  const emailLower = normalizeEmail(admin?.email);
  if (!settings || !admin || !admin.name?.trim() || !emailLower || !admin.password) {
    throw new Error('Incomplete setup payload.');
  }

  console.log('[SETUP] initializeCompany started:', { lodge_id: state.lodgeId, email: emailLower, profile_status: activeProfile.status });

  let savedSettings;
  try {
    // Draft company setup has no lodge session yet. Allow security-definer /
    // service-role bootstrap so the first settings row can be created before
    // the first admin user exists (required for multi-product same-email setup).
    savedSettings = await saveSettings(settings, { allowBootstrap: true });
  } catch (error) {
    if (error?.code) throw error;
    const message = error?.message || 'Could not save lodge settings.';
    const code = isBackendAuthSchemaError(message)
      ? 'backend_auth_schema_outdated'
      : isRowLevelSecurityError(message)
        ? 'settings_rls_blocked'
        : 'settings_save_failed';
    throw createAppError(code, message, { lodge_id: state.lodgeId, email: emailLower });
  }

  const userId = await createUser({
    name: admin.name.trim(),
    email: emailLower,
    password: admin.password,
    role: admin.role || 'admin'
  });

  const authHealth = await runAuthHealthCheck(emailLower, { expectedUserId: userId });
  if (!authHealth.ok) {
    throw createAppError(authHealth.code || 'setup_failed', authHealth.error || 'Initial auth health check failed.', {
      lodge_id: state.lodgeId,
      user_id: userId,
      auth_health: authHealth
    });
  }

  if (authHealth.user) {
    upsertCachedUser(authHealth.user);
  }
  updateProfileMetadata(state.lodgeId, {
    label: profileLabelFromSettings(savedSettings, activeProfile.label),
    status: PROFILE_STATUS.READY
  });
  return {
    lodge_id: state.lodgeId,
    settings: savedSettings,
    user_id: userId,
    auth_health: authHealth,
    profile: getActiveProfile()
  };
}
