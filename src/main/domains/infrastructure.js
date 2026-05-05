import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getRoleCapabilities, normalizeAppRole, isPosFullAccessRole } from "../../shared/accessControl.js";
import { FINANCIAL_SYNC_TABLES, isFinancialSyncItem, pickNextReadySyncItemIndex } from "../../shared/syncQueue.js";
import {
  MONTHLY_USAGE_RESET_COPY,
  canCreateBooking,
  canCreateRoom,
  canCreateUser,
  countMonthlyCreatedBookings,
  countMonthlyUsageBookings,
  evaluateBookingCreationAllowance,
  getNextSubscriptionPlan,
  getPlanUsageLimits,
  getPlanRecommendation,
  normalizeSubscriptionPlan } from
"../../shared/subscriptionPlans.js";

// ─── SUPABASE CREDENTIALS ─────────────────────────────────────────────────────
// URL + ANON KEY — baked in at build time from the root .env file by electron-vite.
// Neither value is a secret (Supabase designed the anon key to be public-facing),
// but keeping them in .env rather than source code means they are not committed to
// the git repository and can be rotated without a code change.
//
// Before building, create a root .env file (see .env.example):
//   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
//   VITE_SUPABASE_KEY=<anon-public-key>
//
// SERVICE ROLE KEY — SECRET. Never put this in .env or source code.
// Set as an OS environment variable on the Command Central admin machine ONLY:
//   Windows PowerShell:
//     [System.Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','<key>','User')
//   macOS / Linux (add to ~/.zshrc or ~/.bashrc):
//     export SUPABASE_SERVICE_ROLE_KEY='<key>'
//
// Lodge customer machines will NOT have this variable → adminDb stays null →
// admin-only functions return a clear error instead of exposing privileged access.
// ─────────────────────────────────────────────────────────────────────────────
import { state } from "../state.js";const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY;
const AUTH_REDIRECT_URL = (
process.env.BOROKO_AUTH_REDIRECT_URL ||
import.meta.env.VITE_AUTH_REDIRECT_URL ||
'').
trim();

























const AUTH_CONTRACT_VERSION = 2;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PROFILE_STATUS = {
  DRAFT: 'draft',
  READY: 'ready'
};
const ENTITLEMENT_FEATURES = ['reports', 'expenses', 'staff', 'pwa', 'audit', 'conference', 'pool', 'import', 'pos', 'inventory', 'supplies', 'online_booking'];
const PLAN_FEATURE_MAP = {
  Starter: {
    reports: false, expenses: false, staff: false, pwa: false, audit: false,
    conference: false, pool: false, import: false, pos: false,
    inventory: false, supplies: false, online_booking: false
  },
  Standard: {
    reports: true, expenses: true, staff: true, pwa: false, audit: true,
    conference: true, pool: true, import: true, pos: false,
    inventory: false, supplies: false, online_booking: false
  },
  Pro: {
    reports: true, expenses: true, staff: true, pwa: true, audit: true,
    conference: true, pool: true, import: true, pos: true,
    inventory: true, supplies: true, online_booking: true
  }
};
const PWA_DISABLED_MESSAGE = 'Manager mobile app access disabled.';
const PWA_ROLE_DISABLED_MESSAGE = 'Only manager and admin roles can use the manager mobile app.';
export const DEFAULT_SUBSCRIPTION_GRACE_DAYS = 7;
export const DEFAULT_OFFLINE_LEASE_DAYS = 7;
export const LOCAL_TIME_ZONE = 'Africa/Gaborone';
const FINANCIAL_VALIDATION_RUNS_FILE = 'financial-validation-runs.json';
const FINANCIAL_VALIDATION_ALERTS_FILE = 'financial-validation-alerts.json';
const LOCAL_INVOICE_DELIVERY_FILE = 'invoice-delivery-history.json';
const CRITICAL_ERROR_LOG_FILE = 'critical-errors.json';
const SYNC_META_FILE = 'sync-meta.json';
const HEALTH_FAULTS_FILE = 'health-faults.json';
const CACHE_FRESHNESS_FILE = 'cache-freshness.json';
const SYNC_DRIFT_FAULT_TYPES = ['customer_drift', 'room_drift', 'quotation_drift', 'pos_drift'];
const CONNECTIVITY_CHECK_INTERVAL_MS = 3000;
const CONNECTIVITY_PROBE_TIMEOUT_MS = 4000;
const CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD = 3;
const PERIODIC_SYNC_INTERVAL_MS = 15000;
export const DEBUG_CACHE_FALLBACKS = process.env.BOROKO_DEBUG_CACHE_FALLBACKS === 'true';
const BACKUP_POLICY_DEFAULT = {
  enabled: false,
  target_dir: '',
  export_json: true,
  export_excel: true,
  frequency_days: 7,
  last_run_at: null,
  last_success_at: null,
  last_error: '',
  last_json_path: '',
  last_excel_path: ''
};
const PROFILE_CACHE_FILES = {
  settings: [],
  users: [],
  rooms: [],
  customers: [],
  bookings: [],
  quotations: [],
  expenses: [],
  outlets: [],
  'conference-bookings': [],
  'pool-day-use': [],
  'inventory-items': [],
  'inventory-purchases': [],
  'pos-menu-items': [],
  'pos-orders': [],
  'pos-order-items': [],
  'pos-void-history': [],
  activity: [],
  auth: [],
  syncQueue: [],
  syncFailed: [],
  syncMeta: null,
  healthFaults: [],
  cacheFreshness: null,
  trialStatus: null
};

function buildSupabaseClient(key, sessionToken = null) {
  const token = typeof sessionToken === 'string' && sessionToken.trim() ? sessionToken.trim() : null;
  authTrace('buildSupabaseClient', {
    clientKind: key === SUPABASE_ANON_KEY ? 'anon' : 'non-anon',
    hasExplicitSessionToken: !!token,
    explicitSessionTokenLength: token ? token.length : null,
    currentLodgeId: state.lodgeId
  });
  return createClient(SUPABASE_URL, key, {
    global: {
      headers: token ? { 'x-boroko-session': token } : {}
    }
  });
}

function buildSupabaseAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

function getAuthRedirectUrl() {
  return AUTH_REDIRECT_URL || undefined;
}

function applyBackendSession(session) {
  authTrace('applyBackendSession', {
    hasIncomingToken: !!session?.token,
    incomingTokenLength: session?.token ? session.token.length : null,
    session_type: session?.session_type || null,
    expires_at: session?.expires_at || null,
    lodgeId: state.lodgeId
  });
  state.backendSession = session?.token ?
  {
    token: session.token,
    expires_at: session.expires_at || null,
    session_type: session.session_type || 'desktop'
  } :
  null;
  state.supabase = buildSupabaseClient(SUPABASE_ANON_KEY, state.backendSession?.token || null);
}

export function clearBackendSession() {
  authTrace('clearBackendSession', {
    hadBackendSession: !!state.backendSession?.token,
    backendSessionType: state.backendSession?.session_type || null,
    lodgeId: state.lodgeId
  });
  applyBackendSession(null);
}

function getBackendSession() {
  return state.backendSession ? { ...state.backendSession } : null;
}

export function normalizePlanName(plan) {
  const raw = String(plan || '').trim().toLowerCase();
  if (!raw) return 'Starter';
  if (raw === 'basic') return 'Starter';
  if (raw === 'premium') return 'Pro';
  if (raw === 'starter') return 'Starter';
  if (raw === 'standard') return 'Standard';
  if (raw === 'pro') return 'Pro';
  return 'Starter';
}

function normalizeStaffRole(role) {
  return String(role || '').trim().toLowerCase() || 'receptionist';
}

function isPwaEligibleRole(role) {
  const normalized = normalizeStaffRole(role);
  return normalized === 'manager' || normalized === 'admin';
}

function normalizePwaDisabledReason(reason, fallback = PWA_DISABLED_MESSAGE) {
  const value = String(reason || '').trim();
  return value || fallback;
}

function cloneFeatureMap(map = {}) {
  return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, map[feature] !== false]));
}

export function toPositiveInt(value, fallback) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function addDays(dateValue, days) {
  const value = new Date(dateValue || Date.now());
  value.setDate(value.getDate() + days);
  return value;
}

function minDate(values = []) {
  const valid = values.
  map((value) => value ? new Date(value) : null).
  filter((value) => value && Number.isFinite(value.getTime()));
  if (valid.length === 0) return null;
  return new Date(Math.min(...valid.map((value) => value.getTime())));
}

export function computeSubscriptionState({
  payment_status,
  next_due_date,
  expires_at,
  is_active = true,
  grace_period_days = DEFAULT_SUBSCRIPTION_GRACE_DAYS
} = {}) {
  if (is_active === false) return 'inactive';

  const rawStatus = String(payment_status || 'active').trim().toLowerCase() || 'active';
  if (rawStatus === 'cancelled') return 'cancelled';

  if (expires_at) {
    const expiry = new Date(expires_at);
    if (Number.isFinite(expiry.getTime()) && expiry < new Date()) {
      return 'expired';
    }
  }

  if (rawStatus === 'suspended' || rawStatus === 'paused') return 'suspended';
  if (rawStatus === 'trial') return 'trial';
  if (rawStatus === 'free') return 'active';

  if (next_due_date) {
    const dueDate = new Date(next_due_date);
    if (Number.isFinite(dueDate.getTime())) {
      const today = new Date();
      const dueStart = new Date(dueDate);
      dueStart.setHours(0, 0, 0, 0);
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      if (dueStart < todayStart) {
        const graceEnd = addDays(dueStart, Math.max(Number(grace_period_days || 0), 0) + 1);
        return graceEnd < today ? 'suspended' : 'grace_period';
      }
    }
  }

  if (rawStatus === 'overdue') return 'grace_period';
  return 'active';
}

export function subscriptionAllowsAccess(state) {
  return state === 'active' || state === 'grace_period' || state === 'trial';
}

export function computeGracePeriodEnd(nextDueDate, gracePeriodDays = DEFAULT_SUBSCRIPTION_GRACE_DAYS) {
  if (!nextDueDate) return null;
  const dueDate = new Date(nextDueDate);
  if (!Number.isFinite(dueDate.getTime())) return null;
  return addDays(dueDate, Math.max(Number(gracePeriodDays || 0), 0) + 1).toISOString();
}

export function computeOfflineValidUntil({
  subscription_state,
  expires_at,
  next_due_date,
  grace_period_days = DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  offline_lease_days = DEFAULT_OFFLINE_LEASE_DAYS,
  trial_end = null
} = {}) {
  if (subscription_state && !subscriptionAllowsAccess(subscription_state)) {
    return new Date().toISOString();
  }

  const leaseEnd = addDays(new Date(), toPositiveInt(offline_lease_days, DEFAULT_OFFLINE_LEASE_DAYS));
  const candidates = [leaseEnd];
  const graceEnd = computeGracePeriodEnd(next_due_date, grace_period_days);
  if (graceEnd) candidates.push(graceEnd);
  if (expires_at) candidates.push(expires_at);
  if (trial_end) candidates.push(trial_end);
  return (minDate(candidates) || leaseEnd).toISOString();
}

export function getPlanFeatureMap(plan, { trial = false, expired = false } = {}) {
  if (trial) return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, true]));
  if (expired) return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, false]));
  return cloneFeatureMap(PLAN_FEATURE_MAP[normalizePlanName(plan)] || PLAN_FEATURE_MAP.Starter);
}

export function mergeFeatureOverrides(baseMap = {}, overrides = []) {
  const next = { ...baseMap };
  for (const row of overrides || []) {
    const featureName = String(row?.feature_name || '').trim();
    if (!featureName) continue;
    next[featureName] = row?.enabled !== false;
  }
  return next;
}

export function ensureDir(dirPath) {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function getManagedBackupPolicyPath() {
  return path.join(app.getPath('userData'), 'managed-backup-policy.json');
}

function normalizeManagedBackupPolicy(raw = {}) {
  return {
    enabled: raw?.enabled === true,
    target_dir: typeof raw?.target_dir === 'string' ? raw.target_dir.trim() : '',
    export_json: raw?.export_json !== false,
    export_excel: raw?.export_excel !== false,
    frequency_days: Number(raw?.frequency_days) > 0 ? Number(raw.frequency_days) : 7,
    last_run_at: raw?.last_run_at || null,
    last_success_at: raw?.last_success_at || null,
    last_error: typeof raw?.last_error === 'string' ? raw.last_error : '',
    last_json_path: typeof raw?.last_json_path === 'string' ? raw.last_json_path : '',
    last_excel_path: typeof raw?.last_excel_path === 'string' ? raw.last_excel_path : ''
  };
}

function buildManagedBackupStatus(policy) {
  const normalized = normalizeManagedBackupPolicy(policy);
  const now = new Date();
  const lastSuccessAt = normalized.last_success_at ? new Date(normalized.last_success_at) : null;
  const nextDueAt = lastSuccessAt ?
  new Date(lastSuccessAt.getTime() + normalized.frequency_days * 24 * 60 * 60 * 1000) :
  null;
  const overdue = normalized.enabled && normalized.target_dir ?
  !lastSuccessAt || nextDueAt && nextDueAt.getTime() < now.getTime() :
  false;
  const requiresSetup = normalized.enabled && !normalized.target_dir;
  const hasRecentSuccess = !!lastSuccessAt;

  return {
    ...normalized,
    next_due_at: nextDueAt ? nextDueAt.toISOString() : null,
    overdue,
    requires_setup: requiresSetup,
    has_recent_success: hasRecentSuccess,
    compliance_state: requiresSetup ?
    'setup_required' :
    overdue ?
    'overdue' :
    hasRecentSuccess ?
    'healthy' :
    normalized.enabled ? 'pending_first_run' : 'disabled'
  };
}

// ─── PROFILES / LEGACY LODGE ID ──────────────────────────────────────────────
// Older builds stored a single lodge ID and one shared cache directory.
// Newer builds store multiple lodge profiles on one PC and activate one at a
// time by swapping the runtime lodgeId/cacheDir underneath existing functions.

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
  ['settings.json', PROFILE_CACHE_FILES.settings],
  ['users.json', PROFILE_CACHE_FILES.users],
  ['rooms.json', PROFILE_CACHE_FILES.rooms],
  ['customers.json', PROFILE_CACHE_FILES.customers],
  ['bookings.json', PROFILE_CACHE_FILES.bookings],
  ['quotations.json', PROFILE_CACHE_FILES.quotations],
  ['expenses.json', PROFILE_CACHE_FILES.expenses],
  ['outlets.json', PROFILE_CACHE_FILES.outlets],
  ['conference-bookings.json', PROFILE_CACHE_FILES['conference-bookings']],
  ['pool-day-use.json', PROFILE_CACHE_FILES['pool-day-use']],
  ['inventory-items.json', PROFILE_CACHE_FILES['inventory-items']],
  ['inventory-purchases.json', PROFILE_CACHE_FILES['inventory-purchases']],
  ['pos-menu-items.json', PROFILE_CACHE_FILES['pos-menu-items']],
  ['pos-orders.json', PROFILE_CACHE_FILES['pos-orders']],
  ['pos-order-items.json', PROFILE_CACHE_FILES['pos-order-items']],
  ['pos-void-history.json', PROFILE_CACHE_FILES['pos-void-history']],
  ['activity-log.json', PROFILE_CACHE_FILES.activity],
  ['auth-cache.json', PROFILE_CACHE_FILES.auth],
  ['sync-queue.json', PROFILE_CACHE_FILES.syncQueue],
  ['sync-failed.json', PROFILE_CACHE_FILES.syncFailed],
  ['sync-meta.json', PROFILE_CACHE_FILES.syncMeta],
  ['health-faults.json', PROFILE_CACHE_FILES.healthFaults],
  ['cache-freshness.json', PROFILE_CACHE_FILES.cacheFreshness],
  ['trial_status.json', PROFILE_CACHE_FILES.trialStatus]];


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
  'quotations.json',
  'expenses.json',
  'outlets.json',
  'conference-bookings.json',
  'pool-day-use.json',
  'inventory-items.json',
  'inventory-purchases.json',
  'pos-menu-items.json',
  'pos-orders.json',
  'pos-order-items.json',
  'pos-void-history.json',
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
  'quotations.json',
  'expenses.json',
  'outlets.json',
  'conference-bookings.json',
  'pool-day-use.json',
  'inventory-items.json',
  'inventory-purchases.json',
  'pos-menu-items.json',
  'pos-orders.json',
  'pos-order-items.json',
  'pos-void-history.json',
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

function initializeProfileRuntime() {
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

function removeLocalCompanyProfile(targetLodgeId) {
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

// Returns the admin (service-role) Supabase client, or throws a clear error if
// the SUPABASE_SERVICE_ROLE_KEY env var was not set on this machine.
// Use this in any function that queries across all lodges (Command Central only).
export function requireAdmin() {
  if (!state.adminDb) {
    throw new Error(
      'This operation requires Command Central admin access. ' +
      'Set the SUPABASE_SERVICE_ROLE_KEY environment variable on this machine. ' +
      'See setup documentation for details.'
    );
  }
  return state.adminDb;
}

/**
 * Returns the outlet filter for the current user's POS access.
 * null  = unrestricted (manager / admin / super_admin / master admin)
 * []    = no access (cashier/supervisor with no outlets assigned)
 * [id1] = restricted to these outlet UUIDs
 */
export function getUserPosOutletFilter() {
  if (!state.currentUser) return [];
  if (state.currentUser.isMasterAdmin) return null;
  if (isPosFullAccessRole(state.currentUser.role)) return null;
  return Array.isArray(state.currentUser.allowed_outlet_ids) ? state.currentUser.allowed_outlet_ids : [];
}

function normalizeSessionUser(user) {
  if (!user || typeof user !== 'object') return user || null;

  const normalized = {
    ...user,
    id: user.id || user.user_id || null,
    email: normalizeEmail(user.email),
    name: typeof user.name === 'string' ? user.name : user.name || '',
    role: user.role || null,
    lodge_id: normalizeLodgeId(user.lodge_id || user.lodgeId || null)
  };

  if (Object.prototype.hasOwnProperty.call(user, 'allowed_outlet_ids')) {
    if (user.allowed_outlet_ids === null) {
      normalized.allowed_outlet_ids = null;
    } else if (Array.isArray(user.allowed_outlet_ids)) {
      normalized.allowed_outlet_ids = [...user.allowed_outlet_ids];
    } else if (user.allowed_outlet_ids === undefined) {
      delete normalized.allowed_outlet_ids;
    }
  } else {
    delete normalized.allowed_outlet_ids;
  }

  return normalized;
}

function mergeSessionUserScope(existingUser, refreshedUser) {
  const existing = normalizeSessionUser(existingUser) || null;
  const refreshed = normalizeSessionUser(refreshedUser) || null;

  if (!existing) return refreshed;
  if (!refreshed) return existing;

  const next = { ...existing, ...refreshed };
  const refreshedHasScope = Object.prototype.hasOwnProperty.call(refreshed, 'allowed_outlet_ids');
  const existingHasScope = Object.prototype.hasOwnProperty.call(existing, 'allowed_outlet_ids');

  if (refreshedHasScope) {
    next.allowed_outlet_ids = refreshed.allowed_outlet_ids;
  } else if (existingHasScope) {
    next.allowed_outlet_ids = existing.allowed_outlet_ids;
  } else {
    delete next.allowed_outlet_ids;
  }

  return next;
}

export function setCurrentUser(user) {
  state.currentUser = normalizeSessionUser(user);
  if (state.currentUser?.isMasterAdmin) {
    clearBackendSession();
  }
  // P0-5: a real user is now authenticated — allow queue replay
  if (state.currentUser) {
    state.replayAuthReady = true;
  }
}

export function getCurrentUser() {
  return state.currentUser;
}

export function logoutCurrentUser({ forgetTrustedSession = false } = {}) {
  state.currentUser = null;
  state.replayAuthReady = false;
  clearBackendSession();
  if (forgetTrustedSession) clearSessionNonce();
}

// Restores the main-process session using a nonce that was issued during login.
// The nonce file (session-nonce.json) is the single source of truth for session
// identity — the renderer cannot influence which user is restored.
// Passing null/undefined clears the trusted device session.
export function restoreUserSession(nonce) {
  authTrace('restoreSession start', { hasNonce: !!nonce, nonceLength: typeof nonce === 'string' ? nonce.length : null });
  console.log('[AUTH] restoreSession requested');
  if (!nonce) {
    state.currentUser = null;
    clearBackendSession();
    clearSessionNonce();
    console.log('[AUTH] restoreSession cleared current user');
    authTrace('restoreSession result', { restored: false, reason: 'no_nonce' });
    return null;
  }

  // Validate nonce against the current session, or any saved trusted session
  // for this lodge. This allows multiple staff to unlock their own saved
  // offline sessions on the same computer.
  let stored = readSessionNonce();
  if (!stored || stored.nonce !== nonce) {
    stored = pruneExpiredTrustedSessions().
    map(normalizeTrustedSessionRecord).
    filter(Boolean).
    find((session) => session.nonce === nonce && (!session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId)));
  }
  if (!stored || stored.nonce !== nonce) {
    console.warn('[AUTH] restoreSession REJECTED: invalid or missing session nonce');
    state.currentUser = null;
    clearBackendSession();
    authTrace('restoreSession result', { restored: false, reason: 'invalid_or_missing_nonce' });
    return null;
  }

  // Expiry check
  const age = Date.now() - new Date(stored.createdAt).getTime();
  if (age > SESSION_NONCE_MAX_AGE_MS) {
    console.warn('[AUTH] restoreSession REJECTED: nonce expired', { ageMs: age });
    state.currentUser = null;
    clearBackendSession();
    clearSessionNonce();
    authTrace('restoreSession result', { restored: false, reason: 'nonce_expired' });
    return null;
  }

  // Identity derived from nonce file, NOT from renderer
  const userId = stored.userId;
  if (stored.isMasterAdmin) {
    clearBackendSession();
    const safeUser = normalizeSessionUser({
      id: userId,
      email: stored.email || '',
      name: stored.name || 'Master Admin',
      role: stored.role || 'super_admin',
      isMasterAdmin: true
    });
    setCurrentUser(safeUser);
    console.log('[AUTH] restoreSession restored master admin:', {
      userId: safeUser.id,
      email: safeUser.email
    });
    authTrace('restoreSession result', { restored: true, userId: safeUser.id, role: safeUser.role, isMasterAdmin: true });
    return safeUser;
  }

  if (stored.email && stored.role) {
    applyBackendSession({
      token: stored.session_token || null,
      expires_at: stored.session_expires_at || null,
      session_type: stored.session_type || 'desktop'
    });
    const users = readCache('users').
    map(normalizeUserRecord).
    filter(Boolean);
    const cachedById = users.find((u) => u.id === userId && (u.lodge_id ? u.lodge_id === state.lodgeId : true));
    const cachedByEmail = stored.email ?
    users.find((u) => u.email === normalizeEmail(stored.email) && (u.lodge_id ? u.lodge_id === state.lodgeId : true)) :
    null;
    const hasStoredScope = Object.prototype.hasOwnProperty.call(stored, 'allowed_outlet_ids');
    const nonceUser = normalizeSessionUser({
      id: userId,
      email: stored.email,
      name: stored.name || '',
      role: stored.role,
      lodge_id: stored.lodge_id || state.lodgeId,
      ...(hasStoredScope ? { allowed_outlet_ids: stored.allowed_outlet_ids } : {})
    });
    const mergedUser = hasStoredScope ?
    nonceUser :
    mergeSessionUserScope(
      nonceUser,
      cachedById || cachedByEmail || {
        allowed_outlet_ids: isPosFullAccessRole(stored.role) ?
        null :
        []
      }
    );
    const safeUser = normalizeSessionUser(mergedUser);
    setCurrentUser(safeUser);
    console.log('[AUTH] restoreSession restored from nonce metadata:', {
      userId: safeUser.id,
      email: safeUser.email,
      lodge_id: safeUser.lodge_id || state.lodgeId
    });
    authTrace('restoreSession result', { restored: true, userId: safeUser.id, lodge_id: safeUser.lodge_id || state.lodgeId, source: 'nonce_metadata' });
    return safeUser;
  }

  const users = readCache('users');
  const user = users.
  map(normalizeUserRecord).
  filter(Boolean).
  find((u) => u.id === userId && (u.lodge_id ? u.lodge_id === state.lodgeId : true));
  if (!user) {
    console.warn('[AUTH] restoreSession cache miss for stored userId:', userId);
    state.currentUser = null;
    clearBackendSession();
    clearSessionNonce();
    authTrace('restoreSession result', { restored: false, reason: 'user_cache_miss', userId });
    return null;
  }
  const { password_hash: _ph, ...safeUser } = user;
  setCurrentUser(safeUser);
  console.log('[AUTH] restoreSession restored:', {
    userId: safeUser.id,
    email: safeUser.email,
    lodge_id: safeUser.lodge_id || state.lodgeId
  });
  authTrace('restoreSession result', { restored: true, userId: safeUser.id, lodge_id: safeUser.lodge_id || state.lodgeId, source: 'cache' });
  return safeUser;
}

export function restoreSavedTrustedSession(email = '', password = '') {
  const emailLower = normalizeEmail(email);
  const sessions = pruneExpiredTrustedSessions().
  map(normalizeTrustedSessionRecord).
  filter(Boolean).
  filter((session) => !session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId));

  const legacy = normalizeTrustedSessionRecord(readSessionNonce());
  const candidates = [
  ...sessions,
  ...(legacy ? [legacy] : [])].
  filter((session, index, all) => {
    const key = session.id || session.email || session.nonce;
    return all.findIndex((entry) => (entry.id || entry.email || entry.nonce) === key) === index;
  });

  const matches = emailLower ?
  candidates.filter((session) => session.email === emailLower) :
  candidates;

  if (matches.length === 0) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'no_saved_session', email: emailLower });
    return { user: null, nonce: '', code: 'no_saved_trusted_session' };
  }
  if (!emailLower && matches.length > 1) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'email_required', count: matches.length });
    return { user: null, nonce: '', code: 'email_required', error: 'Choose the staff account to open its saved offline session.' };
  }
  if (!password) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'password_required', email: emailLower });
    return { user: null, nonce: '', code: 'password_required', error: 'Enter this user password to open the saved offline session.' };
  }

  const session = matches[0];
  if (!session.offline_password_hash) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'password_not_prepared', email: emailLower });
    return {
      user: null,
      nonce: '',
      code: 'offline_password_not_prepared',
      error: 'This saved session was created before offline password unlock was enabled. Connect to the internet and sign in once to prepare it.'
    };
  }
  if (!bcrypt.compareSync(password, session.offline_password_hash)) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'wrong_password', email: emailLower });
    return { user: null, nonce: '', code: 'wrong_password', error: 'Incorrect password for this saved offline session.' };
  }

  const user = restoreUserSession(session.nonce);
  return user ?
  { user, nonce: session.nonce, code: null } :
  { user: null, nonce: '', code: 'saved_session_invalid', error: 'The saved offline session could not be opened. Connect to the internet and sign in again.' };
}

export async function validateCurrentSession() {
  // Master admins authenticate against master_admins table, not Supabase app sessions.
  // They have no backend session token by design — treat as always valid.
  if (state.currentUser?.isMasterAdmin) return state.currentUser;

  const session = getBackendSession();
  // P0-6: Session validation is mandatory — cannot bypass with missing token
  if (!state.currentUser || !session?.token) {
    console.warn('[AUTH] Session validation failed: missing token or user');
    return null;
  }

  if (session.expires_at) {
    const expiryTs = new Date(session.expires_at).getTime();
    if (Number.isFinite(expiryTs) && expiryTs <= Date.now()) {
      console.warn('[AUTH] Offline session expired');
      state.currentUser = null;
      clearBackendSession();
      clearSessionNonce();
      return null;
    }
  }

  await checkOnline();
  if (!state.isOnline) {
    return state.currentUser;
  }

  try {
    const { data, error } = await state.supabase.rpc('validate_app_session', {
      p_session_token: session.token
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      state.currentUser = null;
      clearBackendSession();
      clearSessionNonce();
      return null;
    }

    const rowLodgeId = normalizeLodgeId(row.lodge_id);
    if (
    row.session_type !== (session.session_type || 'desktop') ||
    rowLodgeId && rowLodgeId !== normalizeLodgeId(state.lodgeId))
    {
      state.currentUser = null;
      clearBackendSession();
      clearSessionNonce();
      return null;
    }

    const refreshedUser = normalizeSessionUser({
      ...state.currentUser,
      id: row.id || state.currentUser.id,
      name: row.name || state.currentUser.name,
      email: row.email || state.currentUser.email,
      role: row.role || state.currentUser.role,
      lodge_id: row.lodge_id || state.currentUser.lodge_id || state.lodgeId
    });

    setCurrentUser(refreshedUser);
    upsertCachedUser(refreshedUser);

    const stored = readSessionNonce();
    if (stored?.nonce) {
      writeSessionNonce(refreshedUser, stored.nonce);
    }

    return refreshedUser;
  } catch (error) {
    authTrace('validateCurrentSession failed', {
      message: error?.message || 'unknown_error',
      lodge_id: state.lodgeId
    });
    return state.currentUser;
  }
}

// ─── CACHE HELPERS ────────────────────────────────────────────────────────────

function getCachePath(name) {
  return path.join(state.cacheDir, `${name}.json`);
}

export function readCache(name) {
  const filePath = getCachePath(name);
  const tmpPath = filePath + '.tmp';
  // Crash recovery: if a .tmp file exists, it was written atomically just before
  // a crash-interrupted renameSync. Prefer it over the potentially stale main file.
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
      fs.renameSync(tmpPath, filePath);
      console.warn(`[Cache] Crash-recovery: promoted '${name}.tmp' to main file`);
      return tmpData;
    } catch {
      // .tmp is corrupt — discard it and fall through to main file
      try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
    }
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    if (fs.existsSync(filePath)) {
      console.warn(`[Cache] Parse failed for '${name}' — returning []. Error: ${e.message}`);
      appendHealthFault({
        type: 'cache_corrupt',
        scope: name,
        message: `Cache file '${name}.json' could not be parsed and was reset to empty. Error: ${e.message}`,
        at: new Date().toISOString()
      });
    }
    return [];
  }
}

export function writeCache(name, data, { source = 'local' } = {}) {
  const filePath = getCachePath(name);
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error(`[Cache] Write failed for '${name}':`, e);
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
  }
  // Track freshness metadata for each named cache write
  try {
    const freshnessPath = path.join(state.cacheDir, CACHE_FRESHNESS_FILE);
    let freshness = {};
    try {freshness = JSON.parse(fs.readFileSync(freshnessPath, 'utf-8')) || {};} catch {/* start fresh */}
    freshness[name] = {
      updatedAt: new Date().toISOString(),
      source,
      count: Array.isArray(data) ? data.length : data && typeof data === 'object' ? Object.keys(data).length : 0
    };
    fs.writeFileSync(freshnessPath, JSON.stringify(freshness, null, 2), 'utf-8');
  } catch {/* freshness tracking is non-critical */}
}

export function clearCache(name, fallback = []) {
  writeCache(name, fallback);
}

function quarantineBadJsonFile(filePath, reason = 'corrupt JSON') {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const quarantinePath = `${filePath}.corrupt.${Date.now()}.bak`;
  try {
    fs.renameSync(filePath, quarantinePath);
    console.warn(`[Sync Queue] Quarantined ${path.basename(filePath)} -> ${path.basename(quarantinePath)} (${reason})`);
    return quarantinePath;
  } catch (error) {
    console.error('[Sync Queue] Failed to quarantine corrupt file:', error);
    return null;
  }
}

function normalizeQueueRows(parsed, scope = 'sync-queue') {
  const rows = Array.isArray(parsed) ?
  parsed :
  Array.isArray(parsed?.queue) ?
  parsed.queue :
  Array.isArray(parsed?.items) ?
  parsed.items :
  Array.isArray(parsed?.pending) ?
  parsed.pending :
  null;

  if (!rows) {
    appendHealthFault({
      type: 'queue_corrupt',
      scope,
      message: `${scope}.json contained non-array JSON and was treated as empty.`,
      at: new Date().toISOString()
    });
    return [];
  }

  const validRows = rows.filter((item) => item && typeof item === 'object');
  if (validRows.length !== rows.length) {
    appendHealthFault({
      type: 'queue_corrupt',
      scope,
      message: `${scope}.json contained ${rows.length - validRows.length} malformed item(s); malformed entries were ignored.`,
      at: new Date().toISOString()
    });
  }
  return validRows;
}

export function readSyncQueue() {
  if (!state.cacheDir) return [];
  const filePath = path.join(state.cacheDir, 'sync-queue.json');
  const tmpPath = filePath + '.tmp';
  // Crash recovery: if a .tmp file exists, it was written atomically just before
  // a crash-interrupted renameSync. Prefer it — it may contain queued financial
  // operations (payments, bookings) that would otherwise be lost permanently.
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
      fs.renameSync(tmpPath, filePath);
      console.warn('[Sync Queue] Crash-recovery: promoted sync-queue.tmp to main file');
      return normalizeQueueRows(tmpData, 'sync-queue');
    } catch (error) {
      // .tmp is corrupt — discard it and fall through to main file
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-queue',
        message: `sync-queue.json.tmp could not be parsed and was discarded. Error: ${error.message}`,
        at: new Date().toISOString()
      });
      try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
    }
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return normalizeQueueRows(JSON.parse(data), 'sync-queue');
  } catch (e) {
    if (fs.existsSync(filePath)) {
      console.warn('[Sync Queue] Parse failed — returning []. Error:', e.message);
      const quarantinePath = quarantineBadJsonFile(filePath, e.message);
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-queue',
        message: `sync-queue.json could not be parsed and was quarantined. Queued operations need manual recovery from ${quarantinePath || 'the corrupt queue backup'}. Error: ${e.message}`,
        at: new Date().toISOString()
      });
      writeSyncQueue([]);
    }
    return [];
  }
}

export function writeSyncQueue(queue) {
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, 'sync-queue.json');
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(Array.isArray(queue) ? queue : [], null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error('Sync queue write failed:', e);
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
  }
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function normalizeLodgeId(id) {
  return typeof id === 'string' ? id.trim().toLowerCase() : null;
}

export function isUuid(value) {
  return UUID_PATTERN.test(normalizeLodgeId(value) || '');
}

export function normalizeUserRecord(user) {
  if (!user || typeof user !== 'object') return null;
  const email = normalizeEmail(user.email);
  return {
    ...user,
    id: user.id || user.user_id || null,
    email,
    lodge_id: normalizeLodgeId(user.lodge_id || user.lodgeId || null)
  };
}

function sanitizeUserForRenderer(user) {
  if (!user || typeof user !== 'object') return user;
  const {
    password_hash: _passwordHash,
    pin_hash: _pinHash,
    pwa_password_hash: _pwaPasswordHash,
    ...safeUser
  } = user;
  return safeUser;
}

export function isBackendAuthSchemaError(message = '') {
  return /authenticate_user|authenticate_manager|get_manager_pwa_profile|validate_app_session|set_user_pwa_access|get_lodge_auth_context|schema cache|returned record type|structure of query does not match|contract_version|column .*deleted|column .*lodge_id|column .*password_hash|column .*pwa_|permission denied/i.test(message);
}

function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  console.log(`[AUTH TRACE] ${label}`, payload);
}

function getAuthClientState(kind = 'unknown', sessionToken = null, email = null) {
  const explicitToken = typeof sessionToken === 'string' && sessionToken.trim() ? sessionToken.trim() : null;
  return {
    clientKind: kind,
    hasExplicitSessionToken: !!explicitToken,
    explicitSessionTokenLength: explicitToken ? explicitToken.length : null,
    hasBackendSession: !!state.backendSession?.token,
    backendSessionType: state.backendSession?.session_type || null,
    backendSessionTokenLength: state.backendSession?.token ? state.backendSession.token.length : null,
    lodgeId: state.lodgeId,
    email: email || null
  };
}

function normalizeAuthContractRow(rpcRow) {
  if (!rpcRow || typeof rpcRow !== 'object' || Array.isArray(rpcRow)) {
    return { ok: false, reason: 'authenticate_user did not return a record.' };
  }

  const normalized = {
    contract_version: Number(rpcRow.contract_version),
    found: rpcRow.found,
    authenticated: rpcRow.authenticated === true,
    id: rpcRow.id || null,
    name: typeof rpcRow.name === 'string' ? rpcRow.name : '',
    email: normalizeEmail(rpcRow.email),
    role: typeof rpcRow.role === 'string' ? rpcRow.role : null,
    lodge_id: normalizeLodgeId(rpcRow.lodge_id),
    created_at: rpcRow.created_at || null,
    session_token: typeof rpcRow.session_token === 'string' && rpcRow.session_token ? rpcRow.session_token : null,
    session_expires_at: rpcRow.session_expires_at || null
  };

  if (normalized.contract_version !== AUTH_CONTRACT_VERSION) {
    return { ok: false, reason: `Expected contract_version ${AUTH_CONTRACT_VERSION}.` };
  }
  if (typeof normalized.found !== 'boolean') {
    return { ok: false, reason: 'authenticate_user must return a boolean found flag.' };
  }
  if (typeof normalized.authenticated !== 'boolean') {
    return { ok: false, reason: 'authenticate_user must return an authenticated flag.' };
  }
  if (!isUuid(normalized.lodge_id)) {
    return { ok: false, reason: 'authenticate_user must return a UUID lodge_id.' };
  }
  if (!normalized.email) {
    return { ok: false, reason: 'authenticate_user must return a normalized email.' };
  }
  if (normalized.found) {
    if (!isUuid(normalized.id)) {
      return { ok: false, reason: 'authenticate_user must return a UUID id when found = true.' };
    }
    if (!normalized.role) {
      return { ok: false, reason: 'authenticate_user must return role when found = true.' };
    }
    if (normalized.authenticated && !normalized.session_token) {
      return { ok: false, reason: 'authenticate_user must return a session_token when authenticated = true.' };
    }
  }

  return { ok: true, row: normalized };
}

function makeBackendAuthSchemaError(message, details = {}) {
  console.warn('[AUTH TRACE] schema error wrapper hit', { message, details });
  return {
    user: null,
    code: 'backend_auth_schema_outdated',
    error: message,
    details
  };
}

export function createAppError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export function isReadOnlySessionTouchError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('read-only transaction') && message.includes('update');
}

export function buildReadOnlySessionTouchMessage(featureLabel = 'This screen') {
  return `${featureLabel} is hitting an older database read path that still tries to write during a SELECT. Apply the latest session and entitlement read-only SQL fixes in Supabase, then reload the app.`;
}

// ─── CONNECTIVITY & SYNC ──────────────────────────────────────────────────────

/** True when the Supabase project is reachable over the network (not whether RLS allows reading rooms). */
export async function checkOnline() {
  if (process.env.BOROKO_TEST_FORCE_OFFLINE === 'true') {
    const wasOnline = state.isOnline;
    state.isOnline = false;
    state.consecutiveConnectivityFailures = CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD;
    if (wasOnline) broadcastSyncStatus();
    return state.isOnline;
  }
  const wasOnline = state.isOnline;
  let rawOnline = false;
  const base = SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`
  };
  const fetchWithTimeout = async (url, init = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CONNECTIVITY_PROBE_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, headers, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };
  const reachable = (res) => res.status > 0 && res.status < 500;

  try {
    let res = await fetchWithTimeout(`${base}/auth/v1/health`, { method: 'GET' });
    if (res.status >= 500) {
      res = await fetchWithTimeout(`${base}/rest/v1/`, { method: 'GET' });
    }
    rawOnline = reachable(res);
  } catch {
    try {
      const res = await fetchWithTimeout(`${base}/rest/v1/`, { method: 'GET' });
      rawOnline = reachable(res);
    } catch {
      rawOnline = false;
    }
  }

  if (rawOnline) {
    state.consecutiveConnectivityFailures = 0;
    state.isOnline = true;
  } else {
    state.consecutiveConnectivityFailures += 1;
    if (state.consecutiveConnectivityFailures >= CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD) {
      state.isOnline = false;
    }
  }

  if (wasOnline !== state.isOnline) broadcastSyncStatus();
  return state.isOnline;
}

// Refresh one or more named caches from Supabase. Only fetches what's requested.
export async function refreshCache(...names) {
  try {
    await refreshCacheStrict(...names);
    clearSyncRefreshStale(uniqueSyncNames(names).filter((name) => isSyncRefreshStaleFor(name)));
  } catch (e) {
    console.error('Cache refresh failed:', e);
  }
}

// Full refresh — used only at startup, reconnect, and after bulk operations.
export async function refreshAllCaches() {
  if (!state.lodgeId) return;
  await refreshCache(
    'users',
    'rooms',
    'customers',
    'bookings',
    'maintenance',
    'inventory-items',
    'inventory-purchases',
    'quotations',
    'conference-bookings',
    'pool-day-use',
    'pos-orders',
    'pos-menu-items',
    'outlets',
    'expenses'
  );
}

const MAX_SYNC_RETRIES = 5;
const SYNC_RETRY_BASE_DELAY_MS = 1000;
const SYNC_RETRY_MAX_DELAY_MS = 30_000;
const DEAD_LETTER_AUTO_RETRY_AFTER_MS = 30 * 60 * 1000;
const SYNC_REFRESH_RETRY_BASE_DELAY_MS = 5_000;
const SYNC_REFRESH_RETRY_MAX_DELAY_MS = 60_000;
export const MAX_FINANCIAL_AMOUNT = 1_000_000;
const SYNC_ALREADY_APPLIED_CODES = new Set(['23505']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueSyncNames(names = []) {
  return [...new Set((names || []).filter(Boolean))];
}

function isSyncRefreshStaleFor(name) {
  return state.syncRefreshState.stale && state.syncRefreshState.names.includes(name);
}

function broadcastSyncStatus() {
  try {
    const status = getSyncStatus();
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('sync:status-changed', status);
    });
  } catch (e) {
    console.error('[Sync] IPC broadcast failed:', e);
  }
}

function markSyncRefreshStale(names = [], errorMessage = 'Cache refresh failed.') {
  const mergedNames = uniqueSyncNames([...state.syncRefreshState.names, ...names]);
  state.syncRefreshState = {
    stale: mergedNames.length > 0,
    names: mergedNames,
    attempts: Math.max(1, Number(state.syncRefreshState.attempts || 0)),
    lastError: String(errorMessage || 'Cache refresh failed.'),
    lastFailedAt: new Date().toISOString()
  };
  broadcastSyncStatus();
}

function clearSyncRefreshStale(names = []) {
  if (!state.syncRefreshState.stale) return;
  const clearNames = new Set(uniqueSyncNames(names));
  const remainingNames = clearNames.size === 0 ?
  [] :
  state.syncRefreshState.names.filter((name) => !clearNames.has(name));
  state.syncRefreshState = {
    stale: remainingNames.length > 0,
    names: remainingNames,
    attempts: remainingNames.length > 0 ? state.syncRefreshState.attempts : 0,
    lastError: remainingNames.length > 0 ? state.syncRefreshState.lastError : '',
    lastFailedAt: remainingNames.length > 0 ? state.syncRefreshState.lastFailedAt : null
  };
  if (!state.syncRefreshState.stale && state.syncRefreshRetryTimer) {
    clearTimeout(state.syncRefreshRetryTimer);
    state.syncRefreshRetryTimer = null;
  }
  broadcastSyncStatus();
}

async function refreshCacheStrict(...names) {
  if (!state.lodgeId) return;
  const fetchers = {
    users: () => state.supabase.from('users').select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash').eq('lodge_id', state.lodgeId).order('name'),
    rooms: () => state.supabase.from('rooms').select('*').eq('lodge_id', state.lodgeId).order('room_number'),
    customers: () => state.supabase.from('customers').select('*').eq('lodge_id', state.lodgeId).order('name'),
    bookings: () => state.supabase.from('bookings').select('*').eq('lodge_id', state.lodgeId).order('check_in', { ascending: false }),
    maintenance: () => state.supabase.
    from('maintenance_tickets').
    select('*, rooms(room_number, room_type)').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }),
    'inventory-items': () => state.supabase.from('inventory_items').select('*').eq('lodge_id', state.lodgeId).order('category').order('name'),
    'inventory-purchases': () => state.supabase.from('inventory_purchases').select('*').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    quotations: () => state.supabase.from('quotations').select('*').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }),
    'conference-bookings': () => state.supabase.from('conference_bookings').select('*').eq('lodge_id', state.lodgeId).order('booking_date', { ascending: false }).order('start_time', { ascending: true }),
    'pool-day-use': () => state.supabase.from('pool_day_use').select('*').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    expenses: () => state.supabase.from('expenses').select('*, outlets(name)').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    'pos-orders': () => state.supabase.
    from('pos_orders').
    select('*, pos_order_items(*), outlets(name)').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }),
    'pos-menu-items': () => state.supabase.from('pos_menu_items').select('*').eq('lodge_id', state.lodgeId).order('category').order('name'),
    outlets: () => state.supabase.from('outlets').select('id, name, type, sort_order, is_active').eq('lodge_id', state.lodgeId).order('sort_order')
  };

  await Promise.all(names.map(async (name) => {
    if (!fetchers[name]) return;
    const { data, error } = await fetchers[name]();
    if (error) throw error;
    if (!data) return;
    if (name === 'users') {
      const normalizedUsers = data.map(normalizeUserRecord).filter(Boolean);
      writeCache(name, normalizedUsers, { source: 'remote' });
      if (state.currentUser && !state.currentUser.isMasterAdmin) {
        const refreshedUser = normalizedUsers.find((entry) =>
        state.currentUser.id && entry.id === state.currentUser.id ||
        !state.currentUser.id && state.currentUser.email && entry.email === state.currentUser.email
        );
        if (refreshedUser) {
          setCurrentUser(mergeSessionUserScope(state.currentUser, refreshedUser));
        }
      }
      return;
    }
    if (name === 'bookings') {
      writeCache(name, mergeRemoteBookingsWithLocalState(data || []), { source: 'remote' });
      return;
    }
    if (name === 'inventory-items') {
      writeCache(name, applyQueuedPosInventoryReservations(data || []), { source: 'remote' });
      return;
    }
    if (name === 'pos-orders') {
      writeCache(name, mergeRemotePosOrdersWithLocalState(data || []), { source: 'remote' });
      return;
    }
    writeCache(name, data, { source: 'remote' });
  }));
}

function scheduleSyncRefreshRetry(names = [], reason = 'Background refresh failed.') {
  const mergedNames = uniqueSyncNames([...state.syncRefreshState.names, ...names]);
  if (mergedNames.length === 0) return;

  const nextAttempts = Math.max(1, Number(state.syncRefreshState.attempts || 0) + 1);
  state.syncRefreshState = {
    stale: true,
    names: mergedNames,
    attempts: nextAttempts,
    lastError: String(reason || 'Background refresh failed.'),
    lastFailedAt: new Date().toISOString()
  };
  broadcastSyncStatus();

  if (state.syncRefreshRetryTimer) return;

  const waitMs = Math.min(
    SYNC_REFRESH_RETRY_MAX_DELAY_MS,
    SYNC_REFRESH_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextAttempts - 1))
  );

  state.syncRefreshRetryTimer = setTimeout(async () => {
    state.syncRefreshRetryTimer = null;
    const retryNames = [...state.syncRefreshState.names];
    if (!retryNames.length || !state.isOnline || !state.lodgeId) return;
    try {
      await refreshCacheStrict(...retryNames);
      clearSyncRefreshStale(retryNames);
    } catch (error) {
      console.error('[Sync] Background cache refresh retry failed:', error);
      scheduleSyncRefreshRetry(retryNames, error?.message || 'Background refresh retry failed.');
    }
  }, waitMs);
}

async function refreshCachesAfterSync(...names) {
  const targetNames = uniqueSyncNames(names);
  if (targetNames.length === 0) return;
  try {
    await refreshCacheStrict(...targetNames);
    clearSyncRefreshStale(targetNames);
  } catch (error) {
    console.error('[Sync] Post-sync cache refresh failed:', error);
    markSyncRefreshStale(targetNames, error?.message || 'Post-sync cache refresh failed.');
    scheduleSyncRefreshRetry(targetNames, error?.message || 'Post-sync cache refresh failed.');
  }
}

function createQueueOperationId(prefix = 'op') {
  return `${prefix}-${randomUUID()}`;
}

export function createBookingIdempotencyKey(bookingId) {
  return `create-booking:${bookingId}`;
}

export function createPaymentIdempotencyKey(bookingId, type = 'payment', intentId = null, fallbackSignature = null) {
  if (type === 'deposit') {
    // Deterministic — bound to the booking, safe to replay without generating a duplicate
    return `payment:deposit:${bookingId}`;
  }
  // If intentId is provided, use it for deterministic idempotency across sessions
  if (intentId) {
    return `payment:${type}:${bookingId}:${intentId}`;
  }
  // Fallback: if signature is provided (booking+status+amount), use it for deterministic key
  // This prevents double-payments even if intentKey is lost after app restart
  if (fallbackSignature) {
    return `payment:${type}:${fallbackSignature}`;
  }
  // Last resort: generate random key (logs warning in caller)
  return `payment:${type}:${bookingId}:${randomUUID()}`;
}

export function buildPaymentFallbackSignature(bookingId, type, amount, bookingVersion = null) {
  const normalizedAmount = roundMoneyValue(Math.abs(amount)).toFixed(2);
  const normalizedVersion = bookingVersion || 'no-version';
  return `${bookingId}:${type}:${normalizedAmount}:${normalizedVersion}`;
}

function ensureQueuedItem(item = {}, fallbackType = 'op') {
  return {
    ...item,
    _queue_id: item._queue_id || createQueueOperationId(fallbackType)
  };
}

function getErrorMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isBookingUpdateConflictError(message = '') {
  return /modified on another device|booking conflict|refresh and try again/i.test(String(message || ''));
}

function shouldManualReviewSyncItem(item, errorMessage = '') {
  return item?.table === 'update_booking' && isBookingUpdateConflictError(errorMessage);
}

function isPosCreateOrderQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'create_pos_order';
}

function isPosVoidQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'approve_pos_void_with_pin';
}

function getQueuedPosOrderId(item) {
  const payloadId = String(item?.data?.payload?.id || item?.data?.payload?.order_id || '').trim();
  if (payloadId) return payloadId;

  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith('pos-order-')) {
    const parsedId = queueId.slice('pos-order-'.length).trim();
    if (parsedId) return parsedId;
  }
  if (queueId.startsWith('pos-void-')) {
    const parsedId = queueId.slice('pos-void-'.length).trim();
    if (parsedId) return parsedId;
  }

  console.error('[POS SYNC] Missing staged order id for queue item', {
    queueId: item?._queue_id || null,
    table: item?.table || null
  });
  return null;
}

function getSyncItemBookingId(item) {
  return item?.data?.p_booking_id ||
  item?.data?.payload?.booking_id ||
  item?.data?.payload?.id ||
  item?.data?.p_id ||
  null;
}

function getSyncItemEntityId(item, prefix) {
  const directId = item?.data?.p_id || item?.data?.payload?.id || item?.data?.payload?.user_id || null;
  if (directId) return directId;
  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith(`${prefix}-`)) return queueId.slice(prefix.length + 1).trim() || null;
  return null;
}

function getSyncItemCustomerId(item) {
  return getSyncItemEntityId(item, 'customer');
}

function getSyncItemRoomId(item) {
  return getSyncItemEntityId(item, 'room');
}

function getSyncItemUserId(item) {
  return getSyncItemEntityId(item, 'user');
}

function getSyncItemQuotationId(item) {
  const quotationId = String(item?.data?.p_quotation_id || '').trim();
  if (quotationId) return quotationId;
  return getSyncItemEntityId(item, 'quotation');
}

function getSyncItemScope(item) {
  const bookingId = getSyncItemBookingId(item);
  if (bookingId) return `booking:${bookingId}`;
  const posOrderId = getQueuedPosOrderId(item);
  if (posOrderId) return `pos-order:${posOrderId}`;
  return item?.table || 'unknown';
}

const QUEUED_DEPENDENCY_CACHE_MAP = [
{ prefix: 'booking-', cache: 'bookings' },
{ prefix: 'customer-', cache: 'customers' },
{ prefix: 'room-', cache: 'rooms' },
{ prefix: 'user-', cache: 'users' },
{ prefix: 'quotation-', cache: 'quotations' },
{ prefix: 'pos-order-', cache: 'pos-orders' },
{ prefix: 'conference-booking-', cache: 'conference-bookings' },
{ prefix: 'pool-day-use-', cache: 'pool-day-use' }];


function isQueuedDependencyResolved(dependencyId) {
  const normalizedDependencyId = String(dependencyId || '').trim();
  if (!normalizedDependencyId) return false;

  const target = QUEUED_DEPENDENCY_CACHE_MAP.find(({ prefix }) => normalizedDependencyId.startsWith(prefix));
  if (!target) return false;

  const entityId = normalizedDependencyId.slice(target.prefix.length).trim();
  if (!entityId) return false;

  const cachedRow = readCache(target.cache).find((entry) => entry?.id === entityId);
  if (!cachedRow) return false;

  return cachedRow._pending_sync !== true &&
  cachedRow._sync_state !== 'manual_review_required' &&
  cachedRow._sync_state !== 'failed';
}

export function patchCachedPosOrderSyncState(orderId, patch = {}) {
  if (!orderId) return false;
  const cachedOrders = readCache('pos-orders');
  const index = cachedOrders.findIndex((row) => row?.id === orderId);
  if (index < 0) {
    console.warn('POS sync patch skipped: order not found in cache', orderId);
    return false;
  }

  const existing = cachedOrders[index] || {};
  if (existing._sync_state === 'synced' &&
  patch._sync_state !== 'failed' &&
  patch._pending_sync !== true &&
  !Object.prototype.hasOwnProperty.call(patch, 'status')) {
    return false;
  }

  const next = [...cachedOrders];
  next[index] = {
    ...existing,
    ...patch
  };
  writeCache('pos-orders', next);
  return true;
}

function isCreateBookingQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'create_booking';
}

function isConvertQuotationQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'convert_quotation_to_booking';
}

function getQueuedBookingId(item) {
  const bookingId = String(item?.data?.p_booking_id || '').trim();
  if (bookingId) return bookingId;

  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith('booking-')) {
    const parsedId = queueId.slice('booking-'.length).trim();
    if (parsedId) return parsedId;
  }

  console.error('[BOOKING SYNC] Missing booking id for queue item', {
    queueId: item?._queue_id || null,
    table: item?.table || null
  });
  return null;
}

function getQueuedQuotationId(item) {
  const quotationId = String(item?.data?.p_quotation_id || item?.data?.payload?.id || '').trim();
  if (quotationId) return quotationId;

  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith('quotation-')) {
    const parsedId = queueId.slice('quotation-'.length).trim();
    if (parsedId) return parsedId;
  }

  return null;
}

function isRoomConflictError(message = '') {
  return /no_overlapping_bookings|room is already booked|room is not available|room.*conflict/i.test(String(message || ''));
}

function patchCachedBookingSyncState(bookingId, patch = {}) {
  if (!bookingId) return false;
  const cachedBookings = readCache('bookings');
  const index = cachedBookings.findIndex((row) => row?.id === bookingId);
  if (index < 0) {
    console.warn('Booking sync patch skipped: booking not found in cache', bookingId);
    return false;
  }

  const existing = cachedBookings[index] || {};
  if (existing._sync_state === 'synced' && patch._sync_state !== 'sync_failed') {
    return false;
  }

  const next = [...cachedBookings];
  next[index] = {
    ...existing,
    ...patch
  };
  writeCache('bookings', next);
  return true;
}

function rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId) {
  if (!item || !localBookingId || !serverBookingId || localBookingId === serverBookingId) return item;
  const next = { ...item, data: { ...(item?.data || {}) } };
  let changed = false;
  if (next.data.p_booking_id === localBookingId) {
    next.data.p_booking_id = serverBookingId;
    changed = true;
  }
  if (next.data.p_id === localBookingId) {
    next.data.p_id = serverBookingId;
    changed = true;
  }
  if (next.data.booking_id === localBookingId) {
    next.data.booking_id = serverBookingId;
    changed = true;
  }
  if (next.data.payload?.booking_id === localBookingId) {
    next.data.payload = {
      ...next.data.payload,
      booking_id: serverBookingId
    };
    changed = true;
  }
  if (next._depends_on === `booking-${localBookingId}`) {
    next._depends_on = `booking-${serverBookingId}`;
    changed = true;
  }
  return changed ? next : item;
}

function normalizeQueuedSyncItemForReplay(item = {}) {
  if (!item) return item;
  const next = { ...item, data: { ...(item.data || {}) } };

  if (next.type === 'rpc' && ['update_booking', 'update_customer', 'update_room', 'update_quotation'].includes(next.table) && !('p_expected_updated_at' in next.data)) {
    next.data.p_expected_updated_at = null;
  }

  if (next.type === 'rpc' &&
  next.table === 'update_booking_status' &&
  String(next._depends_on || '').startsWith('booking-')) {
    next.data.p_expected_updated_at = null;
  }

  return next;
}

function replaceQueuedBookingReference(localBookingId, serverBookingId) {
  if (!localBookingId || !serverBookingId || localBookingId === serverBookingId) return false;

  const queued = readSyncQueue();
  const rewrittenQueue = queued.map((item) => rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId));
  if (JSON.stringify(queued) !== JSON.stringify(rewrittenQueue)) {
    writeSyncQueue(rewrittenQueue);
  }

  const failed = readFailedSyncQueue();
  const rewrittenFailed = failed.map((item) => rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId));
  if (JSON.stringify(failed) !== JSON.stringify(rewrittenFailed)) {
    writeFailedSyncQueue(rewrittenFailed);
  }

  return JSON.stringify(queued) !== JSON.stringify(rewrittenQueue) ||
  JSON.stringify(failed) !== JSON.stringify(rewrittenFailed);
}

function patchCachedRowSyncState(cacheName, entityId, patch = {}) {
  if (!entityId) return false;
  const cachedRows = readCache(cacheName);
  const index = cachedRows.findIndex((row) => row?.id === entityId);
  if (index < 0) {
    console.warn(`${cacheName} sync patch skipped: row not found in cache`, entityId);
    return false;
  }
  const next = [...cachedRows];
  next[index] = { ...(cachedRows[index] || {}), ...patch };
  writeCache(cacheName, next);
  return true;
}

function patchCachedCustomerSyncState(customerId, patch = {}) {
  return patchCachedRowSyncState('customers', customerId, patch);
}

function patchCachedRoomSyncState(roomId, patch = {}) {
  return patchCachedRowSyncState('rooms', roomId, patch);
}

function patchCachedUserSyncState(userId, patch = {}) {
  return patchCachedRowSyncState('users', userId, patch);
}

export function patchCachedQuotationSyncState(quotationId, patch = {}) {
  return patchCachedRowSyncState('quotations', quotationId, patch);
}

function markClearedSyncItemForManualReview(item) {
  const manualReviewMessage = `${item?.table || 'sync item'} was cleared from failed sync without server confirmation. Review manually before trusting local data.`;
  const customerId = getSyncItemCustomerId(item);
  if (customerId && /customer/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedCustomerSyncState(customerId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const roomId = getSyncItemRoomId(item);
  if (roomId && /room/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedRoomSyncState(roomId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const userId = getSyncItemUserId(item);
  if (userId && /user/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedUserSyncState(userId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const quotationId = getSyncItemQuotationId(item);
  if (quotationId && /quotation/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedQuotationSyncState(quotationId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const bookingId = getSyncItemBookingId(item);
  if (bookingId) {
    patchCachedBookingSyncState(bookingId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const posOrderId = getQueuedPosOrderId(item);
  if (posOrderId) {
    patchCachedPosOrderSyncState(posOrderId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
  }
}

function valuesEqualForDrift(left, right) {
  if (left == null && right == null) return true;
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return Math.abs(leftNum - rightNum) < 0.0001;
  }
  return String(left) === String(right);
}

function hasDriftBaselineValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function isBenignBookingDriftFault(fault = {}) {
  if (fault?.type !== 'booking_drift') return false;
  const drifts = Array.isArray(fault?.context?.drifts) ?
  fault.context.drifts :
  String(fault?.message || '').split(';').map((entry) => entry.trim()).filter(Boolean);
  if (drifts.length === 0) return false;
  return drifts.every((entry) =>
  /^(customer_id|room_id): local (undefined|null|) ?→ server [0-9a-f-]+$/i.test(String(entry || '').trim())
  );
}

function queueItemNeedsBookingRefresh(item) {
  if (!item) return false;
  if (isPosCreateOrderQueueItem(item)) {
    return !!(item?.data?.payload?.booking_id || item?.data?.payload?.room_id);
  }
  if (item?.type === 'rpc') {
    return new Set([
    'create_booking',
    'update_booking',
    'update_booking_status',
    'update_booking_payment',
    'create_booking_record',
    'convert_quotation_to_booking']
    ).has(item.table);
  }
  return item?.table === 'bookings';
}

function queueItemNeedsInventoryRefresh(item) {
  if (!isPosCreateOrderQueueItem(item) && !isPosVoidQueueItem(item)) return false;
  const items = Array.isArray(item?.data?.payload?.items) ? item.data.payload.items : [];
  return items.some((entry) => !!entry?.menu_item_id || !!entry?.inventory_item_id);
}

function isAlreadyAppliedInsertError(item, error) {
  if (item?.type !== 'insert') return false;
  if (!item?.data?.id) return false;
  const code = String(error?.code || '').trim();
  return SYNC_ALREADY_APPLIED_CODES.has(code);
}

function isAlreadyAppliedRpcError(item, errorOrMessage) {
  if (item?.type !== 'rpc') return false;
  const message = getErrorMessage(errorOrMessage);
  if (isConvertQuotationQueueItem(item) && /quotation is already converted|quotation is already .*converted|already converted/i.test(message)) {
    return true;
  }
  const payloadId = item?.data?.payload?.id || item?.data?.p_booking_id || item?.data?.p_quotation_id || null;
  if (!payloadId) return false;

  const code = String(errorOrMessage?.code || '').trim();
  return SYNC_ALREADY_APPLIED_CODES.has(code) ||
  /duplicate key|unique constraint|already exists|already applied|23505/i.test(message);
}

async function processSyncQueue() {
  if (state.syncInProgress) return { success: false, skipped: true, error: 'Sync is already in progress.' };
  // P0-5: Never replay queued operations before a real user session is confirmed.
  // Offline financial RPCs carry lodge-scoped auth; replaying them before the
  // correct Supabase client/session is restored can poison data or fail silently.
  if (!state.replayAuthReady) {
    console.warn('[Sync] processSyncQueue skipped — replayAuthReady is false (no authenticated session yet)');
    writeSyncMeta({ replayAuthNotReadyAt: new Date().toISOString() });
    return { success: false, skipped: true, error: 'No authenticated session — please log in first.' };
  }
  state.syncInProgress = true;
  try {
    await _runSyncQueue();
    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error);
    console.error('[Sync] Fatal sync loop error:', error);
    appendHealthFault({
      type: 'sync_loop_error',
      scope: 'sync-queue',
      severity: 'error',
      message,
      at: new Date().toISOString()
    });
    writeSyncMeta({
      lastSyncFinishedAt: new Date().toISOString(),
      lastSyncOutcome: 'fatal_error',
      lastSyncError: message
    });
    return { success: false, error: message };
  } finally {
    state.syncInProgress = false;
    broadcastSyncStatus();
  }
}

async function _runSyncQueue() {
  await requeueEligibleFailedSyncItems();
  let queue = readSyncQueue().
  map((item) => ensureQueuedItem(item, item?.type || 'op')).
  map(normalizeQueuedSyncItemForReplay);
  if (queue.length === 0) return;

  // Normalize items left over from a previous (possibly crashed) run.
  // committed → drop (RPC already succeeded; do not retry)
  // in_flight → reset to pending (result unknown; retry — safe for all current operations)
  const normalized = [];
  for (const item of queue) {
    if (item._state === 'committed') {
      console.log('[SYNC COMMITTED CLEANUP]', item._queue_id);
      continue;
    }
    normalized.push(item._state === 'in_flight' ? { ...item, _state: 'pending' } : item);
  }
  if (normalized.length !== queue.length) writeSyncQueue(normalized);
  queue = normalized;

  // P0-1: record that a sync run has started
  writeSyncMeta({ lastSyncStartedAt: new Date().toISOString(), lastSyncOutcome: 'in_progress', lastSyncError: '' });

  console.log(`Syncing ${queue.length} offline operation(s)...`);
  const deadLetter = [];
  let successCount = 0;
  // Tracks _queue_ids of items that failed — dependents will be skipped.
  // Pre-seeded from sync-failed.json so children of a previously dead-lettered
  // parent are blocked immediately, not executed against a non-existent booking.
  // readFailedSyncQueue always returns []; corrupted file cannot crash this path.
  const _priorDeadLetter = readFailedSyncQueue();
  const failedQueueIds = new Set(_priorDeadLetter.map((item) => item._queue_id).filter(Boolean));
  const completedQueueIds = new Set();
  console.log('[SYNC PRELOAD FAILED IDS]', [...failedQueueIds]);
  const pending = [...queue];
  // P1-8: widen post-sync refresh tracking
  let shouldRefreshBookings = false;
  let shouldRefreshInventory = false;
  let shouldRefreshCustomers = false;
  let shouldRefreshRooms = false;
  let shouldRefreshUsers = false;
  let shouldRefreshQuotations = false;
  let shouldRefreshPosOrders = false;
  let shouldRefreshConference = false;
  let shouldRefreshPoolDayUse = false;

  while (pending.length > 0) {
    const nextIndex = pickNextReadySyncItemIndex(
      pending,
      completedQueueIds,
      failedQueueIds,
      isQueuedDependencyResolved
    );
    if (nextIndex === -1) {
      const blockedAt = new Date().toISOString();
      while (pending.length > 0) {
        const blockedItem = {
          ...pending.shift(),
          _state: 'pending',
          retryCount: MAX_SYNC_RETRIES,
          lastError: 'Blocked: unresolved sync dependency cycle',
          lastAttemptedAt: blockedAt,
          manualRetryOnly: true
        };
        if (blockedItem?._queue_id) failedQueueIds.add(blockedItem._queue_id);
        deadLetter.push(blockedItem);
      }
      writeSyncQueue([]);
      break;
    }

    const [item] = pending.splice(nextIndex, 1);
    // Skip items whose parent operation failed this run
    if (item._depends_on && failedQueueIds.has(item._depends_on)) {
      console.warn('[SYNC SKIPPED DEPENDENT]', { operation: item.table, queueId: item._queue_id, dependsOn: item._depends_on });
      const retryCount = (item.retryCount || 0) + 1;
      const skipped = { ...item, _state: 'pending', retryCount, lastError: 'Skipped: parent operation failed', lastAttemptedAt: new Date().toISOString() };
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          console.warn('[POS SYNC] Failed order', orderId, 'Skipped: parent operation failed');
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: 'Skipped: parent operation failed'
          });
        }
      }
      // Also mark related bookings as failed if their create_booking parent failed
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item);
        if (bookingId) {
          console.warn('[BOOKING SYNC] Failed booking', bookingId, 'Skipped: parent operation failed');
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: 'Skipped: parent operation failed'
          });
        }
      }
      if (retryCount >= MAX_SYNC_RETRIES) {
        deadLetter.push(skipped);
      } else {
        pending.push(skipped);
      }
      writeSyncQueue(pending);
      continue;
    }

    const priorRetries = Math.max(0, Number(item.retryCount || 0));
    if (priorRetries > 0) {
      const backoffMs = Math.min(
        SYNC_RETRY_MAX_DELAY_MS,
        SYNC_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, priorRetries - 1))
      );
      console.warn(`[Sync] Backing off ${backoffMs}ms before retrying ${item.type} ${item.table}`);
      await delay(backoffMs);
    }

    // Persist in_flight before issuing remote call.
    // Crash here → restart normalizes to pending and retries safely.
    writeSyncQueue([{ ...item, _state: 'in_flight' }, ...pending]);

    let supabaseError = null;
    let rpcResultData = null;
    try {
      if (item.type === 'insert') {
        const payload = {
          ...item.data,
          lodge_id: item.data.lodge_id || state.lodgeId
        };

        const { data, error } = await state.supabase.
        from(item.table).
        insert(payload).
        select();

        if (error) {
          if (isAlreadyAppliedInsertError(item, error)) {
            console.warn(`↻ INSERT ${item.table} already applied remotely for id ${item.data.id}; treating as synced`);
            supabaseError = null;
          } else {
            console.error('❌ INSERT FAILED:', error);
            supabaseError = error;
          }
        } else {
          console.log('✅ INSERT SUCCESS:', data);
        }
      } else if (item.type === 'update') {
        // P2-14: use .select('id') to verify at least one row was actually matched.
        // A 0-row result means the entity was deleted or moved on the server during
        // the outage — the update is silently lost. We surface this as a health fault
        // rather than treating it as a success.
        const itemLodgeId = item.data?.lodge_id || item.lodge_id || state.lodgeId;
        const { data: updData, error: updError } = await state.supabase.
        from(item.table).
        update(item.data).
        eq('id', item.id).
        eq('lodge_id', itemLodgeId).
        select('id');
        supabaseError = updError || null;
        if (!updError && (!updData || updData.length === 0)) {
          // Row not found on server — record as a fault but treat operation as consumed
          const ghostMsg = `UPDATE ${item.table} id=${item.id} matched 0 rows on server (entity may have been deleted during outage)`;
          console.warn('[Sync] Ghost update:', ghostMsg);
          appendHealthFault({ type: 'ghost_update', scope: item.table, message: ghostMsg, at: new Date().toISOString() });
        }
      } else if (item.type === 'delete') {
        const itemLodgeId = item.data?.lodge_id || item.lodge_id || state.lodgeId;
        ({ error: supabaseError } = await state.supabase.from(item.table).delete().eq('id', item.id).eq('lodge_id', itemLodgeId));
      } else if (item.type === 'rpc') {
        const { data, error } = await state.supabase.rpc(item.table, item.data);
        rpcResultData = data || null;
        if (error) {
          if (isAlreadyAppliedRpcError(item, error)) {
            console.warn(`↻ RPC ${item.table} already applied remotely for queued id; treating as synced`, item._queue_id);
            supabaseError = null;
          } else {
            console.error(`❌ RPC ${item.table} FAILED:`, error);
            supabaseError = error;
          }
        } else if (data && data.success === false) {
          if (isAlreadyAppliedRpcError(item, data.error)) {
            console.warn(`↻ RPC ${item.table} reported duplicate for queued id; treating as synced`, item._queue_id);
            supabaseError = null;
          } else {
            console.error(`❌ RPC ${item.table} LOGIC FAILED:`, data.error);
            supabaseError = { message: data.error };
          }
        } else {
          console.log(`✅ RPC ${item.table} SUCCESS:`, data);
        }
      }
    } catch (e) {
      supabaseError = { message: e.message };
    }

    if (supabaseError) {
      // Track failed queue IDs so dependents are skipped
      if (item._queue_id) failedQueueIds.add(item._queue_id);
      const errorMessage = getErrorMessage(supabaseError);
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          console.warn('[POS SYNC] Failed order', orderId, errorMessage);
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          });
        }
      }
      if (isPosVoidQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          console.warn('[POS VOID SYNC] Failed void', orderId, errorMessage);
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `POS void rejected by server: ${errorMessage}`
          });
          patchLocalPosVoidHistory(item?.data?.payload?.override_log_id, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          });
        }
      }
      // P1-13: mark rejected optimistic state for update/payment/status RPCs
      if (item.type === 'rpc' && ['update_booking', 'update_booking_status', 'update_booking_payment', 'add_booking_charge', 'delete_booking_charge', 'approve_booking_refund'].includes(item.table)) {
        const bookingId = item.data?.p_booking_id || item.data?.p_id || null;
        if (bookingId) {
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `${item.table} rejected by server: ${errorMessage}`
          });
        }
      }
      // Handle booking creation failures (especially room conflicts)
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item);
        if (bookingId) {
          const isConflict = isRoomConflictError(errorMessage);
          console.warn('[BOOKING SYNC] Failed booking', bookingId, isConflict ? '(room conflict)' : '', errorMessage);
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          });
          // Notify renderer about booking conflict
          if (isConflict) {
            try {
              BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed()) {
                  win.webContents.send('booking:sync-conflict', {
                    bookingId,
                    error: 'This room is already booked for the selected dates.',
                    details: errorMessage
                  });
                }
              });
            } catch (e) {
              console.error('[BOOKING SYNC] Failed to notify renderer:', e);
            }
          }
        }
      }
      if (isConvertQuotationQueueItem(item)) {
        const quotationId = getSyncItemQuotationId(item);
        const localBookingId = item._local_booking_id || null;
        const isConflict = isRoomConflictError(errorMessage);
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            status: item._previous_status || 'accepted',
            converted_booking_id: null,
            _pending_sync: true,
            _pending_conversion: false,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          });
        }
        if (localBookingId) {
          patchCachedBookingSyncState(localBookingId, {
            _pending_sync: true,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          });
        }
      }
      const retryCount = (item.retryCount || 0) + 1;
      const manualReviewOnly = shouldManualReviewSyncItem(item, errorMessage) ||
      (isCreateBookingQueueItem(item) || isConvertQuotationQueueItem(item)) && isRoomConflictError(errorMessage) ||
      item.manualRetryOnly === true;
      const updatedItem = {
        ...item,
        _state: 'pending', // reset from in_flight
        retryCount: manualReviewOnly ? MAX_SYNC_RETRIES : retryCount,
        lastError: errorMessage,
        lastAttemptedAt: new Date().toISOString(),
        manualRetryOnly: manualReviewOnly
      };
      if (updatedItem.retryCount >= MAX_SYNC_RETRIES) {
        console.error(`[Sync] Dead-lettered after ${MAX_SYNC_RETRIES} attempts — ${item.type} ${item.table}:`, errorMessage);
        deadLetter.push(updatedItem);
      } else {
        console.warn(`[Sync] Failed (attempt ${updatedItem.retryCount}/${MAX_SYNC_RETRIES}) — ${item.type} ${item.table}:`, errorMessage);
        pending.push(updatedItem);
      }
      writeSyncQueue(pending);
    } else {
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[POS SYNC] Synced order', orderId);
        }
      }
      if (isPosVoidQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _pending_void: false,
            _synced_at: new Date().toISOString()
          });
          patchLocalPosVoidHistory(item?.data?.payload?.override_log_id, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null
          });
          console.log('[POS VOID SYNC] Synced void', orderId);
        }
      }
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item);
        if (bookingId) {
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[BOOKING SYNC] Synced booking', bookingId);
        }
      }
      if (isConvertQuotationQueueItem(item)) {
        const quotationId = getSyncItemQuotationId(item);
        const localBookingId = item._local_booking_id || null;
        const serverBookingId = rpcResultData?.booking_id || rpcResultData?.id || null;
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            ...(serverBookingId ? { converted_booking_id: serverBookingId } : {}),
            _pending_sync: false,
            _pending_conversion: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
        }
        if (localBookingId) {
          replaceQueuedBookingReference(localBookingId, serverBookingId);
          if (serverBookingId) {
            for (let i = 0; i < pending.length; i += 1) {
              pending[i] = rewriteQueuedBookingReferenceItem(pending[i], localBookingId, serverBookingId);
            }
          }
          patchCachedBookingSyncState(localBookingId, {
            ...(serverBookingId ? { id: serverBookingId } : {}),
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
        }
      }
      if (queueItemNeedsInventoryRefresh(item)) shouldRefreshInventory = true;
      if (queueItemNeedsBookingRefresh(item)) shouldRefreshBookings = true;
      // P1-8: widen refresh to cover all domains touched by this operation
      if (item.type === 'rpc' && ['create_customer', 'update_customer'].includes(item.table)) shouldRefreshCustomers = true;
      if (item.table === 'rooms' || item.type === 'rpc' && item.table?.startsWith?.('update_room')) shouldRefreshRooms = true;
      if (item.type === 'rpc' && ['create_user', 'update_user_profile', 'set_user_pwa_access'].includes(item.table)) shouldRefreshUsers = true;
      if (item.type === 'rpc' && ['create_quotation', 'update_quotation', 'convert_quotation', 'convert_quotation_to_booking'].includes(item.table)) shouldRefreshQuotations = true;
      if (isPosCreateOrderQueueItem(item) || isPosVoidQueueItem(item)) shouldRefreshPosOrders = true;
      if (item.type === 'rpc' && ['create_conference_booking', 'update_conference_booking', 'delete_conference_booking'].includes(item.table)) shouldRefreshConference = true;
      if (item.type === 'rpc' && ['add_pool_day_use', 'delete_pool_day_use'].includes(item.table)) shouldRefreshPoolDayUse = true;
      // Phase 1: persist committed state before removing from queue file.
      // Crash here → restart sees 'committed' → skips RPC without retrying.
      writeSyncQueue([{ ...item, _state: 'committed' }, ...pending]);
      if (item._queue_id) completedQueueIds.add(item._queue_id);
      // Phase 2: remove item from queue
      successCount++;
      writeSyncQueue(pending);
    }
  }
  const syncFinishedAt = new Date().toISOString();
  console.log(`✅ Sync complete: ${successCount} success, ${pending.length} remaining`);
  if (successCount > 0) {
    state.lastSuccessfulSyncAt = syncFinishedAt;
    // P0-1: persist sync recency to disk so it survives restarts
    writeSyncMeta({
      lastSuccessfulSyncAt: syncFinishedAt,
      lastSyncFinishedAt: syncFinishedAt,
      lastSyncOutcome: deadLetter.length > 0 ? 'partial' : 'success',
      lastSyncError: deadLetter.length > 0 ? `${deadLetter.length} item(s) dead-lettered` : ''
    });
  } else if (deadLetter.length > 0) {
    writeSyncMeta({
      lastSyncFinishedAt: syncFinishedAt,
      lastSyncOutcome: 'failed',
      lastSyncError: `All ${deadLetter.length} item(s) dead-lettered with no successes`
    });
  } else {
    writeSyncMeta({ lastSyncFinishedAt: syncFinishedAt, lastSyncOutcome: 'empty' });
  }
  writeSyncQueue(pending);

  if (successCount > 0 && shouldRefreshInventory) {
    refreshCache('inventory-items', 'inventory-purchases').catch(() => {});
  }

  // P2-16: snapshot optimistic booking state before refresh so we can detect drift afterwards
  const preSyncBookingSnapshot = shouldRefreshBookings ?
  readCache('bookings').
  filter((b) => !b._pending_sync).
  reduce((map, b) => {
    map[b.id] = {
      total_amount: b.total_amount,
      amount_paid: b.amount_paid,
      customer_id: b.customer_id,
      room_id: b.room_id,
      status: b.status,
      payment_status: b.payment_status
    };
    return map;
  }, {}) :
  null;

  // P1-8: widen canonical post-sync refresh
  const refreshTargets = [];
  if (successCount > 0 && shouldRefreshBookings) refreshTargets.push('bookings');
  if (successCount > 0 && shouldRefreshCustomers) refreshTargets.push('customers');
  if (successCount > 0 && shouldRefreshRooms) refreshTargets.push('rooms');
  if (successCount > 0 && shouldRefreshUsers) refreshTargets.push('users');
  if (successCount > 0 && shouldRefreshQuotations) refreshTargets.push('quotations');
  if (successCount > 0 && shouldRefreshPosOrders) refreshTargets.push('pos-orders');
  if (successCount > 0 && shouldRefreshConference) refreshTargets.push('conference-bookings');
  if (successCount > 0 && shouldRefreshPoolDayUse) refreshTargets.push('pool-day-use');
  if (refreshTargets.length > 0) {
    await refreshCachesAfterSync(...refreshTargets);
  }

  // P2-16: compare post-refresh server values against pre-refresh optimistic state
  if (preSyncBookingSnapshot && successCount > 0) {
    try {
      const postSyncBookings = readCache('bookings');
      for (const b of postSyncBookings) {
        const pre = preSyncBookingSnapshot[b.id];
        if (!pre) continue;
        const drifts = [];
        if (!valuesEqualForDrift(pre.total_amount, b.total_amount)) drifts.push(`total_amount: local ${pre.total_amount} → server ${b.total_amount}`);
        if (!valuesEqualForDrift(pre.amount_paid, b.amount_paid)) drifts.push(`amount_paid: local ${pre.amount_paid} → server ${b.amount_paid}`);
        if (hasDriftBaselineValue(pre.customer_id) && !valuesEqualForDrift(pre.customer_id, b.customer_id)) drifts.push(`customer_id: local ${pre.customer_id} → server ${b.customer_id}`);
        if (hasDriftBaselineValue(pre.room_id) && !valuesEqualForDrift(pre.room_id, b.room_id)) drifts.push(`room_id: local ${pre.room_id} → server ${b.room_id}`);
        if (!valuesEqualForDrift(pre.status, b.status)) drifts.push(`status: local ${pre.status} → server ${b.status}`);
        if (!valuesEqualForDrift(pre.payment_status, b.payment_status)) drifts.push(`payment_status: local ${pre.payment_status} → server ${b.payment_status}`);
        if (drifts.length > 0) {
          appendHealthFault({
            type: 'booking_drift',
            scope: `booking:${b.id}`,
            severity: 'warn',
            message: `Post-sync drift on booking ${b.id}: ${drifts.join('; ')}`,
            context: { booking_id: b.id, drifts, invoice_number: b.invoice_number || null }
          });
          console.warn('[SYNC DRIFT]', b.id, drifts);
        }
      }
    } catch (driftError) {
      console.error('[Sync] Drift check failed:', driftError);
    }
  }

  if (deadLetter.length > 0) {
    const deadPath = path.join(state.cacheDir, 'sync-failed.json');
    const deadTmp = deadPath + '.tmp';
    let existing = [];
    try {existing = JSON.parse(fs.readFileSync(deadPath, 'utf-8'));} catch {/* empty */}
    try {
      fs.writeFileSync(deadTmp, JSON.stringify([...existing, ...deadLetter], null, 2), 'utf-8');
      fs.renameSync(deadTmp, deadPath);
    } catch (e) {
      console.error('[Sync] Dead-letter write failed:', e);
      try {fs.unlinkSync(deadTmp);} catch {/* ignore */}
    }
    for (const item of deadLetter) {
      console.error('[SYNC DEAD LETTER]', item);
    }
  }

  console.log(`[Sync] Done — ${successCount} synced, ${pending.length} retrying, ${deadLetter.length} dead-lettered`);

  broadcastSyncStatus();
}

export function getSyncStatus() {
  const queue = readSyncQueue();
  const failed = readFailedSyncQueue();
  const faults = readHealthFaults();
  const syncMeta = readSyncMeta();
  const extractBookingId = (item) =>
  item?.data?.p_booking_id ||
  item?.data?.payload?.booking_id ||
  item?.data?.payload?.id ||
  item?.data?.p_id ||
  item?._local_booking_id ||
  null;

  const failedBookingIds = failed.
  filter((item) => ['create_booking', 'create_booking_record', 'update_booking'].includes(item.table)).
  map((item) => item.data?.p_booking_id || item.data?.payload?.id || item.data?.p_id).
  filter(Boolean);
  const financialPendingBookingIds = [...new Set(
    queue.
    filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table)).
    map(extractBookingId).
    filter(Boolean)
  )];
  const financialFailedBookingIds = [...new Set(
    failed.
    filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table)).
    map(extractBookingId).
    filter(Boolean)
  )];
  const financialPendingCount = queue.filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table)).length;
  const financialFailedCount = failed.filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table)).length;
  const groupedCounts = buildSyncGroupedCounts(queue, failed);
  // P0-1: lastSuccessfulSyncAt from memory first, fall back to persisted meta
  const resolvedLastSync = state.lastSuccessfulSyncAt || syncMeta.lastSuccessfulSyncAt || null;
  return {
    pending: queue.length,
    failed: failed.length,
    // P0-2: named fields as specified
    currentQueueLength: queue.length,
    currentDeadLetterWrites: failed.length,
    isOnline: state.isOnline,
    // P0-2: expose replay in-progress state
    syncInProgress: state.syncInProgress,
    replayAuthReady: state.replayAuthReady,
    failedBookingIds,
    financialPendingBookingIds,
    financialFailedBookingIds,
    financialPendingCount,
    financialFailedCount,
    groupedCounts,
    lastSuccessfulSyncAt: resolvedLastSync,
    // P0-1: full sync meta
    syncMeta: {
      lastSyncStartedAt: syncMeta.lastSyncStartedAt || null,
      lastSyncFinishedAt: syncMeta.lastSyncFinishedAt || null,
      lastSyncOutcome: syncMeta.lastSyncOutcome || null,
      lastSyncError: syncMeta.lastSyncError || '',
      replayAuthNotReadyAt: syncMeta.replayAuthNotReadyAt || null
    },
    // P0-4: expose corruption/integrity faults
    faults,
    cacheStale: {
      active: state.syncRefreshState.stale,
      names: state.syncRefreshState.names,
      attempts: state.syncRefreshState.attempts,
      lastError: state.syncRefreshState.lastError,
      lastFailedAt: state.syncRefreshState.lastFailedAt
    }
  };
}

function classifySyncDependencyCategory(item = {}, pending = [], failed = []) {
  const dependencyId = String(item?._depends_on || '').trim();
  if (!dependencyId) return 'none';

  if (failed.some((entry) => entry?._queue_id === dependencyId)) {
    return 'blocked_dependencies';
  }
  if (pending.some((entry) => entry?._queue_id === dependencyId)) {
    return 'blocked_dependencies';
  }
  if (isQueuedDependencyResolved(dependencyId)) {
    return 'resolved';
  }
  return 'missing_parent';
}

function getSyncDependencyLabel(category = 'none') {
  switch (category) {
    case 'missing_parent':
      return 'Blocked: missing parent sync item';
    case 'blocked_dependencies':
      return 'Blocked: waiting for parent sync item';
    case 'resolved':
      return 'Ready: parent already synced';
    default:
      return 'No dependency';
  }
}

function getSyncDisplayError(item = {}, dependencyCategory = 'none') {
  if (dependencyCategory === 'missing_parent') return 'Blocked: missing parent sync item';
  if (dependencyCategory === 'blocked_dependencies' && /Skipped: parent operation failed/i.test(String(item?.lastError || ''))) {
    return 'Blocked: parent sync item failed';
  }
  return item?.lastError || '';
}

function buildSyncGroupedCounts(pending = [], failed = []) {
  const pendingMissingParent = pending.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'missing_parent').length;
  const failedMissingParent = failed.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'missing_parent').length;
  const pendingBlockedDependencies = pending.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'blocked_dependencies').length;
  const failedBlockedDependencies = failed.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'blocked_dependencies').length;
  const financialRiskItems = pending.filter(isFinancialSyncItem).length + failed.filter(isFinancialSyncItem).length;

  return {
    missing_parent: pendingMissingParent + failedMissingParent,
    blocked_dependencies: pendingBlockedDependencies + failedBlockedDependencies,
    financial_risk_items: financialRiskItems,
    failed_items: failed.length,
    pending_items: pending.length
  };
}

function readFailedSyncQueue() {
  if (!state.cacheDir) return [];
  const filePath = path.join(state.cacheDir, 'sync-failed.json');
  const tmpPath = filePath + '.tmp';
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
      fs.renameSync(tmpPath, filePath);
      console.warn('[Sync Queue] Crash-recovery: promoted sync-failed.tmp to main file');
      return normalizeQueueRows(tmpData, 'sync-failed');
    } catch (error) {
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-failed',
        message: `sync-failed.json.tmp could not be parsed and was discarded. Error: ${error.message}`,
        at: new Date().toISOString()
      });
      try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
    }
  }

  try {
    return normalizeQueueRows(JSON.parse(fs.readFileSync(filePath, 'utf-8')), 'sync-failed');
  } catch (e) {
    if (fs.existsSync(filePath)) {
      const quarantinePath = quarantineBadJsonFile(filePath, e.message);
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-failed',
        message: `sync-failed.json could not be parsed and was quarantined. Dead-lettered operations need manual recovery from ${quarantinePath || 'the corrupt failed-queue backup'}. Error: ${e.message}`,
        at: new Date().toISOString()
      });
      writeFailedSyncQueue([]);
    }
    return [];
  }
}

export function writeFailedSyncQueue(items) {
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, 'sync-failed.json');
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(Array.isArray(items) ? items : [], null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error('[Sync] Failed-queue write failed:', e);
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
  }
}

// ─── SYNC META (P0-1) ─────────────────────────────────────────────────────────
// Persists sync recency data to disk so it survives app restarts.

export function readSyncMeta() {
  if (!state.cacheDir) return {};
  try {
    const raw = fs.readFileSync(path.join(state.cacheDir, SYNC_META_FILE), 'utf-8');
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function writeSyncMeta(updates = {}) {
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, SYNC_META_FILE);
  const tmpPath = filePath + '.tmp';
  try {
    const current = readSyncMeta();
    const next = { ...current, ...updates };
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error('[Sync Meta] Write failed:', e);
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
  }
}

// ─── HEALTH FAULTS (P0-4) ─────────────────────────────────────────────────────
// Structured corruption / integrity alerts that survive restarts.

function appendHealthFault(fault = {}) {
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, HEALTH_FAULTS_FILE);
  const tmpPath = filePath + '.tmp';
  try {
    let existing = [];
    try {existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));} catch {/* start fresh */}
    if (!Array.isArray(existing)) existing = [];
    const entry = {
      id: randomUUID(),
      type: fault.type || 'unknown',
      scope: fault.scope || 'unknown',
      severity: fault.severity || 'warn',
      message: fault.message || 'An integrity fault was detected.',
      at: fault.at || new Date().toISOString(),
      ...(fault.context && typeof fault.context === 'object' ? { context: fault.context } : {})
    };
    // Deduplicate: don't append a fault with the same type+scope within 10 minutes
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const isDuplicate = existing.some(
      (e) => e.type === entry.type && e.scope === entry.scope && Date.parse(e.at) > tenMinutesAgo
    );
    if (isDuplicate) return;
    const next = [entry, ...existing].slice(0, 50);
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    console.error('[Health Fault]', entry);
  } catch (e) {
    console.error('[Health Fault] Write failed:', e);
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
  }
}

function readHealthFaults() {
  if (!state.cacheDir) return [];
  const filePath = path.join(state.cacheDir, HEALTH_FAULTS_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    const next = parsed.filter((fault) => !isBenignBookingDriftFault(fault));
    if (next.length !== parsed.length) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8');
      } catch (writeError) {
        console.warn('[Health Fault] Could not prune benign booking drift faults:', writeError?.message || writeError);
      }
    }
    return next;
  } catch {
    return [];
  }
}

export function clearHealthFault(id) {
  if (!state.cacheDir) return { success: true, remaining: 0 };
  const filePath = path.join(state.cacheDir, HEALTH_FAULTS_FILE);
  const tmpPath = filePath + '.tmp';
  try {
    const faults = readHealthFaults();
    const next = id ? faults.filter((f) => f.id !== id) : [];
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return { success: true, remaining: next.length };
  } catch (e) {
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
    return { success: false, error: e.message };
  }
}

// ─── CACHE FRESHNESS READER (P1-9) ────────────────────────────────────────────

function readCacheFreshness() {
  if (!state.cacheDir) return {};
  try {
    const raw = fs.readFileSync(path.join(state.cacheDir, CACHE_FRESHNESS_FILE), 'utf-8');
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

export function getSyncDetails() {
  const pending = readSyncQueue();
  const failed = readFailedSyncQueue();
  const faults = readHealthFaults();
  const syncMeta = readSyncMeta();
  const cacheFreshness = readCacheFreshness();
  const resolvedLastSync = state.lastSuccessfulSyncAt || syncMeta.lastSuccessfulSyncAt || null;
  const now = Date.now();

  const enrichPending = (item) => {
    const dependencyCategory = classifySyncDependencyCategory(item, pending, failed);
    return {
      ...item,
      isFinancial: isFinancialSyncItem(item),
      dependencyState: item?._depends_on ?
      failed.some((f) => f?._queue_id === item._depends_on) ?
      'failed_parent' :
      pending.some((p) => p?._queue_id === item._depends_on) ?
      'waiting_for_parent' :
      'ready_or_external' :
      'none',
      dependencyCategory,
      dependencyLabel: getSyncDependencyLabel(dependencyCategory)
    };
  };

  // P1-11: enrich failed items with retry classification and timing
  const enrichFailed = (item) => {
    const attemptedAtMs = item.lastAttemptedAt ? Date.parse(item.lastAttemptedAt) : NaN;
    const ageMs = Number.isNaN(attemptedAtMs) ? null : now - attemptedAtMs;
    const isAutoRetryable = item.manualRetryOnly !== true;
    const nextAutoRetryAt = isAutoRetryable && !Number.isNaN(attemptedAtMs) ?
    new Date(attemptedAtMs + DEAD_LETTER_AUTO_RETRY_AFTER_MS).toISOString() :
    null;
    const autoRetryEligible = isAutoRetryable && (Number.isNaN(attemptedAtMs) || ageMs >= DEAD_LETTER_AUTO_RETRY_AFTER_MS);
    return {
      ...item,
      isFinancial: isFinancialSyncItem(item),
      dependencyCategory: classifySyncDependencyCategory(item, pending, failed),
      dependencyLabel: getSyncDependencyLabel(classifySyncDependencyCategory(item, pending, failed)),
      displayError: getSyncDisplayError(item, classifySyncDependencyCategory(item, pending, failed)),
      isAutoRetryable,
      nextAutoRetryAt,
      autoRetryEligible,
      ageMs
    };
  };

  const extractBookingId = (item) =>
  item?.data?.p_booking_id || item?.data?.payload?.booking_id || item?.data?.payload?.id || item?.data?.p_id || item?._local_booking_id || null;

  const financialPendingBookingIds = [...new Set(pending.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).map(extractBookingId).filter(Boolean))];
  const financialFailedBookingIds = [...new Set(failed.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).map(extractBookingId).filter(Boolean))];
  const financialPendingCount = pending.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).length;
  const financialFailedCount = failed.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).length;
  const groupedCounts = buildSyncGroupedCounts(pending, failed);
  const unresolvedLocal = [
  ...readCache('bookings').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'booking', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('customers').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'customer', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('rooms').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'room', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('users').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'user', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('quotations').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'quotation', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('pos-orders').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'pos-order', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('conference-bookings').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'conference-booking', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('pool-day-use').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'pool-day-use', id: row.id, sync_state: row._sync_state || 'pending' }))];


  // P1-9: annotate cache freshness with human-readable age
  const enrichedCacheFreshness = Object.fromEntries(
    Object.entries(cacheFreshness).map(([name, meta]) => {
      const updatedAtMs = meta?.updatedAt ? Date.parse(meta.updatedAt) : NaN;
      const cacheAgeMs = Number.isNaN(updatedAtMs) ? null : now - updatedAtMs;
      return [name, { ...meta, cacheAgeMs, stale: cacheAgeMs != null && cacheAgeMs > 24 * 60 * 60 * 1000 }];
    })
  );

  return {
    isOnline: state.isOnline,
    syncInProgress: state.syncInProgress,
    replayAuthReady: state.replayAuthReady,
    pendingCount: pending.length,
    failedCount: failed.length,
    lastSuccessfulSyncAt: resolvedLastSync,
    syncMeta: {
      lastSyncStartedAt: syncMeta.lastSyncStartedAt || null,
      lastSyncFinishedAt: syncMeta.lastSyncFinishedAt || null,
      lastSyncOutcome: syncMeta.lastSyncOutcome || null,
      lastSyncError: syncMeta.lastSyncError || ''
    },
    financialPendingBookingIds,
    financialFailedBookingIds,
    unresolvedLocal,
    financialPendingCount,
    financialFailedCount,
    groupedCounts,
    pending: pending.map(enrichPending),
    failed: failed.map(enrichFailed),
    faults,
    cacheFreshness: enrichedCacheFreshness,
    cacheStale: {
      active: state.syncRefreshState.stale,
      names: state.syncRefreshState.names,
      attempts: state.syncRefreshState.attempts,
      lastError: state.syncRefreshState.lastError,
      lastFailedAt: state.syncRefreshState.lastFailedAt
    }
  };
}

async function requeueEligibleFailedSyncItems(minAgeMs = DEAD_LETTER_AUTO_RETRY_AFTER_MS) {
  const failed = readFailedSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  if (failed.length === 0) return { retried: 0, remaining: 0 };

  const now = Date.now();
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const existingIds = new Set(queue.map((item) => item._queue_id));
  const keepFailed = [];
  const retryItems = [];

  for (const item of failed) {
    const attemptedAtMs = item.lastAttemptedAt ? Date.parse(item.lastAttemptedAt) : NaN;
    const shouldRetry = Number.isNaN(attemptedAtMs) || now - attemptedAtMs >= minAgeMs;
    if (item.manualRetryOnly === true || !shouldRetry) {
      keepFailed.push(item);
      continue;
    }

    const cleanItem = normalizeQueuedSyncItemForReplay({
      ...item,
      _state: 'pending',
      retryCount: 0,
      lastError: '',
      lastAttemptedAt: null
    });

    if (!existingIds.has(cleanItem._queue_id)) {
      queue.push(cleanItem);
      existingIds.add(cleanItem._queue_id);
    }

    if (isPosCreateOrderQueueItem(cleanItem)) {
      const orderId = getQueuedPosOrderId(cleanItem);
      if (orderId) {
        patchCachedPosOrderSyncState(orderId, {
          _sync_state: 'pending',
          _sync_error: null
        });
      }
    }

    retryItems.push(cleanItem);
  }

  if (retryItems.length === 0) return { retried: 0, remaining: failed.length };

  writeFailedSyncQueue(keepFailed);
  writeSyncQueue(queue);
  console.warn(`[Sync] Auto-requeued ${retryItems.length} dead-lettered item(s) for another attempt.`);
  broadcastSyncStatus();
  return { retried: retryItems.length, remaining: keepFailed.length };
}

export async function retrySyncItems(queueIds = []) {
  const failed = readFailedSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const targetIds = new Set((queueIds || []).filter(Boolean));
  const shouldRetryAll = targetIds.size === 0;
  const retryItems = failed.filter((item) => shouldRetryAll || targetIds.has(item._queue_id));
  if (retryItems.length === 0) return { success: true, retried: 0, remaining: failed.length };

  const keepFailed = failed.filter((item) => !retryItems.some((entry) => entry._queue_id === item._queue_id));
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const existingIds = new Set(queue.map((item) => item._queue_id));
  for (const item of retryItems) {
    const cleanItem = normalizeQueuedSyncItemForReplay({
      ...item,
      _state: 'pending',
      retryCount: Math.max(0, Number(item.retryCount || 1) - 1),
      lastError: '',
      lastAttemptedAt: null
    });
    if (isPosCreateOrderQueueItem(cleanItem)) {
      const orderId = getQueuedPosOrderId(cleanItem);
      if (orderId) {
        console.log('[POS SYNC] Retrying order', orderId);
        patchCachedPosOrderSyncState(orderId, {
          _sync_state: 'pending',
          _sync_error: null
        });
      }
    }
    if (!existingIds.has(cleanItem._queue_id)) queue.push(cleanItem);
  }
  writeFailedSyncQueue(keepFailed);
  writeSyncQueue(queue);
  if (state.isOnline) await processSyncQueue();
  return { success: true, retried: retryItems.length, remaining: keepFailed.length };
}

export function clearSyncFailed(queueIds = []) {
  const failed = readFailedSyncQueue();
  const targetIds = new Set((queueIds || []).filter(Boolean));
  const shouldClearAll = targetIds.size === 0;
  const itemsToRemove = shouldClearAll ?
  failed :
  failed.filter((item) => targetIds.has(item?._queue_id));

  // P1-12: Before discarding dead letters, preserve unresolved-local-state evidence
  // so a clear action cannot falsely imply reconciliation is complete.
  const financialCleared = itemsToRemove.filter((item) => isFinancialSyncItem(item));
  let integrityAlertsRecorded = 0;
  for (const item of itemsToRemove) {
    markClearedSyncItemForManualReview(item);
    const isFinancial = isFinancialSyncItem(item);
    appendHealthFault({
      type: isFinancial ? 'financial_dead_letter_cleared' : 'dead_letter_cleared',
      scope: getSyncItemScope(item),
      severity: isFinancial ? 'error' : 'warn',
      message: `${isFinancial ? 'Financial' : 'Sync'} dead-lettered operation was manually cleared without remote confirmation. Operation: ${item.table}, Queue ID: ${item._queue_id}, Last error: ${item.lastError || 'unknown'}. Verify manually that this was handled.`,
      at: new Date().toISOString(),
      context: {
        queue_id: item?._queue_id || null,
        table: item?.table || null,
        booking_id: getSyncItemBookingId(item),
        pos_order_id: getQueuedPosOrderId(item),
        last_error: item?.lastError || '',
        is_financial: isFinancial
      }
    });
    integrityAlertsRecorded++;
    console.warn('[Sync] Dead letter cleared without remote confirmation:', item._queue_id, item.table);
  }

  const remaining = failed.filter((item) => !itemsToRemove.some((r) => r?._queue_id === item?._queue_id));
  writeFailedSyncQueue(remaining);
  broadcastSyncStatus();
  return {
    success: true,
    removed: failed.length - remaining.length,
    financialCleared: financialCleared.length,
    integrityAlertsRecorded,
    remaining: remaining.length
  };
}

// P0-6 / P1-11: Run sync immediately regardless of connectivity transition.
// Called from the "Run Sync Now" button in System Health, and by the periodic timer.
export async function runSyncNow() {
  if (!state.isOnline) {
    await checkOnline();
  }
  if (!state.isOnline) return { success: false, error: 'Offline — cannot sync right now.' };
  if (!state.replayAuthReady) return { success: false, error: 'No authenticated session — please log in first.' };
  await requeueEligibleFailedSyncItems();
  const result = await processSyncQueue();
  return result?.success === false ? result : { success: true };
}

export function queueOperation(type, table, data, id = null, meta = {}) {
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const derivedMeta = {
    ...(type === 'rpc' && table === 'create_quotation' && data?.payload?.id ?
    { _queue_id: `quotation-${data.payload.id}` } :
    {}),
    ...meta
  };
  // Guardrail: create_quotation defaults to _queue_id: `quotation-${record.id}`.
  const queuedItem = ensureQueuedItem({
    type,
    table,
    data,
    id,
    timestamp: new Date().toISOString(),
    ...derivedMeta
  }, type);

  // Deduplication: skip if an identical RPC with same idempotency key is already queued
  if (type === 'rpc' && data?.p_idempotency_key) {
    const existingItem = queue.find(
      (item) => item.type === 'rpc' &&
      item.table === table &&
      item.data?.p_idempotency_key === data.p_idempotency_key
    );
    if (existingItem?._queue_id) {
      console.warn('[SYNC QUEUE] Duplicate idempotent RPC detected — reusing existing queue item', {
        operation: table,
        _queue_id: existingItem._queue_id
      });
      return existingItem._queue_id;
    }
  }

  const hasSameQueueId = queue.some((item) => item._queue_id === queuedItem._queue_id);
  if (hasSameQueueId) {
    console.warn('[SYNC QUEUE] Duplicate _queue_id detected — skipping push', { _queue_id: queuedItem._queue_id, operation: queuedItem.table });
    return queuedItem._queue_id;
  }

  queue.push(queuedItem);
  writeSyncQueue(queue);
  return queuedItem._queue_id;
}

// ─── ACTIVITY LOG ─────────────────────────────────────────────────────────────

export function logActivity(action, description) {
  try {
    const logPath = path.join(state.cacheDir, 'activity-log.json');
    let log = [];
    try {log = JSON.parse(fs.readFileSync(logPath, 'utf-8'));} catch {/* empty */}

    log.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      action,
      description,
      user_id: state.currentUser?.id || null,
      user_name: state.currentUser?.name || 'System'
    });

    if (log.length > 500) log = log.slice(0, 500);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
  } catch (e) {
    console.error('Activity log write failed:', e);
  }
}

export function getLocalDateKey(value = new Date(), timeZone = LOCAL_TIME_ZONE) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(value);
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

export function readAuxiliaryLog(filename) {
  try {
    if (!state.cacheDir) return [];
    const fullPath = path.join(state.cacheDir, filename);
    if (!fs.existsSync(fullPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeAuxiliaryLog(filename, rows) {
  try {
    if (!state.cacheDir) return;
    fs.writeFileSync(path.join(state.cacheDir, filename), JSON.stringify(rows, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Auxiliary log write failed (${filename}):`, error);
  }
}

function appendAuxiliaryLog(filename, row, limit = 200) {
  const current = readAuxiliaryLog(filename);
  current.unshift(row);
  writeAuxiliaryLog(filename, current.slice(0, limit));
}

export function isNonCriticalOperationalError(scope, errorOrMessage = '') {
  const message = errorOrMessage?.message || String(errorOrMessage || '');
  return scope === 'booking.refund' &&
  /Refund approvals require an internet connection/i.test(message);
}

export function recordCriticalError(scope, error, details = {}, { limit = 300, level = 'error' } = {}) {
  const message = error?.message || String(error || 'Unknown error');
  if (isNonCriticalOperationalError(scope, message)) return null;
  const row = {
    id: randomUUID(),
    at: new Date().toISOString(),
    scope,
    level,
    message,
    user_id: state.currentUser?.id || null,
    user_name: state.currentUser?.name || null,
    lodge_id: state.lodgeId || null,
    details
  };
  appendAuxiliaryLog(CRITICAL_ERROR_LOG_FILE, row, limit);
  const logger = level === 'warn' ? console.warn : console.error;
  logger(`[APP ${scope}]`, message, details);
  return row;
}

function clearActivityLogForInfrastructure() {
  try {
    fs.writeFileSync(path.join(state.cacheDir, 'activity-log.json'), '[]', 'utf-8');
  } catch (e) {
    console.error('Clear activity log failed:', e);
  }
}

// ─── AUTO BACKUP ──────────────────────────────────────────────────────────────

export function createBackup() {
  try {
    if (!state.lodgeId) return;
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(backupDir, `backup-${ts}.json`);

    const users = readCache('users').map(({ password_hash, ...u }) => u);

    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      lodge_id: state.lodgeId,
      tables: {
        rooms: readCache('rooms'),
        customers: readCache('customers'),
        bookings: readCache('bookings'),
        users,
        settings: readCache('settings')
      }
    };

    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const files = fs.readdirSync(backupDir).
    filter((f) => f.startsWith('backup-') && f.endsWith('.json')).
    sort().
    reverse();
    for (const old of files.slice(10)) {
      try {fs.unlinkSync(path.join(backupDir, old));} catch {/* ignore */}
    }

    console.log(`Auto-backup saved: ${backupPath}`);
    return backupPath;
  } catch (e) {
    console.error('Auto-backup failed:', e);
    return null;
  }
}

function getManagedBackupPolicyForHealth() {
  return normalizeManagedBackupPolicy(readJsonFile(getManagedBackupPolicyPath(), BACKUP_POLICY_DEFAULT));
}

function getBackupInfoForHealth() {
  try {
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
    if (!fs.existsSync(backupDir)) return { backupDir, backups: [], policy: buildManagedBackupStatus(getManagedBackupPolicyForHealth()) };

    const files = fs.readdirSync(backupDir).
    filter((f) => f.startsWith('backup-') && f.endsWith('.json')).
    sort().
    reverse().
    slice(0, 10);

    const backups = files.map((f) => {
      const stats = fs.statSync(path.join(backupDir, f));
      return { name: f, size: stats.size, created: stats.mtime.toISOString() };
    });

    return { backupDir, backups, policy: buildManagedBackupStatus(getManagedBackupPolicyForHealth()) };
  } catch {
    return { backupDir: '', backups: [], policy: buildManagedBackupStatus(getManagedBackupPolicyForHealth()) };
  }
}

function getBackupHealthSummary(backupsInfo = getBackupInfoForHealth()) {
  const policy = backupsInfo?.policy || buildManagedBackupStatus(getManagedBackupPolicyForHealth());
  const newestLocalBackup = Array.isArray(backupsInfo?.backups) && backupsInfo.backups.length > 0 ?
  backupsInfo.backups[0] :
  null;
  const warnings = [];
  if (policy.enabled && policy.compliance_state !== 'healthy') {
    warnings.push(policy.requires_setup ?
    'Weekly managed backup is enabled but no synced folder is selected.' :
    'Weekly managed backup is overdue or has not completed yet.');
  }
  if (!policy.enabled) {
    warnings.push('Weekly managed backup is disabled.');
  }
  if (!newestLocalBackup) {
    warnings.push('No local JSON backup has been created on this computer.');
  }
  return {
    ok: warnings.length === 0,
    warnings,
    newest_local_backup: newestLocalBackup,
    policy
  };
}

async function buildExpandedBackupPayload() {
  if (!state.lodgeId) throw new Error('No lodge profile selected');
  const [
  settings,
  rooms,
  customers,
  bookings,
  quotations,
  expenses,
  maintenance,
  bookingInvoices,
  conferenceBookings,
  dayUseEntries] =
  await Promise.all([
  getSettings().catch(() => ({})),
  getAllRooms().catch(() => []),
  getAllCustomers().catch(() => []),
  getAllBookings().catch(() => []),
  getAllQuotations().catch(() => []),
  getExpenses('2000-01-01', '2099-12-31').catch(() => []),
  getMaintenanceTickets().catch(() => []),
  getBookingInvoices().catch(() => []),
  getConferenceBookings('2000-01-01', '2099-12-31').catch(() => []),
  getPoolDayUse('2000-01-01', '2099-12-31').catch(() => [])]
  );

  const inventoryItems = await getInventoryItems().catch(() => []);
  const supplyItems = await getSupplyItems().catch(() => []);
  const posOrders = await getPosOrders('2000-01-01', '2099-12-31').catch(() => []);

  const inventoryPurchases = [];
  for (const item of inventoryItems) {
    const purchases = await getInventoryPurchases(item.id).catch(() => []);
    inventoryPurchases.push(...(purchases || []).map((purchase) => ({
      ...purchase,
      item_name: item.name || item.item_name || ''
    })));
  }

  const supplyPurchases = [];
  for (const item of supplyItems) {
    const purchases = await getSupplyPurchases(item.id).catch(() => []);
    supplyPurchases.push(...(purchases || []).map((purchase) => ({
      ...purchase,
      item_name: item.name || item.item_name || ''
    })));
  }

  const backup = {
    timestamp: new Date().toISOString(),
    version: '2.0',
    lodge_id: state.lodgeId,
    mode: 'manual-expanded',
    tables: {
      settings,
      rooms,
      customers,
      bookings,
      quotations,
      booking_invoices: bookingInvoices,
      expenses,
      maintenance,
      pos_orders: posOrders,
      inventory_items: inventoryItems,
      inventory_purchases: inventoryPurchases,
      supply_items: supplyItems,
      supply_purchases: supplyPurchases,
      conference_bookings: conferenceBookings,
      pool_day_use: dayUseEntries,
      sync_status: getSyncStatus()
    }
  };

  return backup;
}

export async function writeExpandedBackupToPath(filePath) {
  const backup = await buildExpandedBackupPayload();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8');
  return { success: true, filePath };
}

export async function createManualBackup() {
  if (!state.lodgeId) throw new Error('No lodge profile selected');
  const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(backupDir, `manual-backup-${ts}.json`);
  return await writeExpandedBackupToPath(backupPath);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

export async function initDatabase() {
  if (state._initialized) {
    console.warn('[DB] initDatabase called more than once — skipping')
    return
  }
  state.cacheRootDir = path.join(app.getPath('userData'), 'boroko-cache');
  state.profilesCacheDir = path.join(state.cacheRootDir, 'profiles');
  initializeProfileRuntime();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'VITE_SUPABASE_URL or VITE_SUPABASE_KEY is missing.\n' +
      'Create a root .env file with both variables, then re-run the app.\n' +
      'See .env.example for the required format.'
    );
  }
  state.supabase = buildSupabaseClient(SUPABASE_ANON_KEY);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey) {
    state.adminDb = buildSupabaseClient(serviceKey);
    console.log('[Auth] SUPABASE_SERVICE_ROLE_KEY found — Command Central admin mode enabled');
  } else {
    state.adminDb = null;
    console.log('[Auth] No SUPABASE_SERVICE_ROLE_KEY — running in lodge-only mode');
  }

  // P0-1: restore persisted sync recency so System Health has real data immediately
  if (state.cacheDir) {
    const meta = readSyncMeta();
    if (meta.lastSuccessfulSyncAt && !state.lastSuccessfulSyncAt) {
      state.lastSuccessfulSyncAt = meta.lastSuccessfulSyncAt;
    }
  }

  // P0-5: replayAuthReady stays false until a real user logs in.
  // Startup sync is intentionally skipped — we must not replay queued financial
  // operations before the correct Supabase client is authenticated.
  let online = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    online = await checkOnline();
    if (online) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
  }
  if (online && state.lodgeId) {
    // Only refresh caches at startup (safe read-only — does not replay writes)
    await refreshAllCaches();
    console.log('Connected to Supabase ✓ (replay deferred until user authenticates)');
  } else {
    console.log('Running in offline mode — using cached data');
  }

  if (!state.backupIntervalStarted) {
    state.backupIntervalStarted = true;

    createBackup();
    setInterval(() => createBackup(), 60 * 60 * 1000);

    // Reconnect detection: fires sync on network return
    setInterval(async () => {
      if (state.connectivityCheckInProgress) return;
      state.connectivityCheckInProgress = true;
      try {
        const wasOffline = !state.isOnline;
        const nowOnline = await checkOnline();
        const hasPendingSync = readSyncQueue().length > 0 || readFailedSyncQueue().some((item) => item?.manualRetryOnly !== true);
        if (nowOnline && state.lodgeId && state.replayAuthReady && (wasOffline || hasPendingSync)) {
          console.log('Back online — syncing changes...');
          await requeueEligibleFailedSyncItems();
          await processSyncQueue();
          if (wasOffline) await refreshAllCaches();
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[Sync] Reconnect sync timer failed:', error);
        appendHealthFault({
          type: 'sync_timer_error',
          scope: 'reconnect',
          severity: 'error',
          message,
          at: new Date().toISOString()
        });
        writeSyncMeta({
          lastSyncFinishedAt: new Date().toISOString(),
          lastSyncOutcome: 'timer_error',
          lastSyncError: message
        });
      } finally {
        state.connectivityCheckInProgress = false;
      }
    }, CONNECTIVITY_CHECK_INTERVAL_MS);

    // P0-6: Periodic sync — ensures retryable dead letters are replayed even when
    // the app never transitions offline→online (i.e., stays continuously online).
    setInterval(async () => {
      try {
        if (!state.isOnline || !state.lodgeId || !state.replayAuthReady) return;
        await requeueEligibleFailedSyncItems();
        if (readSyncQueue().length > 0) {
          await processSyncQueue();
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[Sync] Periodic sync timer failed:', error);
        appendHealthFault({
          type: 'sync_timer_error',
          scope: 'periodic',
          severity: 'error',
          message,
          at: new Date().toISOString()
        });
        writeSyncMeta({
          lastSyncFinishedAt: new Date().toISOString(),
          lastSyncOutcome: 'timer_error',
          lastSyncError: message
        });
      }
    }, PERIODIC_SYNC_INTERVAL_MS);
  }
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

export async function selectProfile(targetLodgeId) {
  const normalizedId = normalizeLodgeId(targetLodgeId);
  const registry = readProfilesRegistry();
  const profile = registry.profiles.find((entry) => entry.lodge_id === normalizedId);
  if (!profile) throw new Error('That lodge profile was not found on this computer.');

  state.currentUser = null;
  state.replayAuthReady = false; // P0-5: profile switch = new auth context required
  clearBackendSession();
  setRuntimeActiveProfile(normalizedId, { persistActive: true, touch: true });
  ensureProfileCacheFiles(normalizedId);

  // Restore persisted sync meta for the new profile
  if (state.cacheDir) {
    const meta = readSyncMeta();
    state.lastSuccessfulSyncAt = meta.lastSuccessfulSyncAt || null;
  }

  await checkOnline();
  if (state.isOnline) {
    // Only refresh caches on profile switch — replay deferred until user logs in
    await refreshAllCaches();
  }

  return {
    ...getActiveProfile(),
    settings: await getSettings()
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
  clearActivityLogForInfrastructure();
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

// ─── AUTH ─────────────────────────────────────────────────────────────────────

// ─── LOCAL TRUSTED DEVICE CACHE ───────────────────────────────────────────────
// The app no longer treats this device as a password verifier. Offline access is
// restored through the signed-in session nonce below; legacy password hashes are
// kept only so older installs can be diagnosed and phased out safely.

export function readAuthCache() {
  try {return JSON.parse(fs.readFileSync(path.join(state.cacheDir, 'auth-cache.json'), 'utf-8'));} catch {return [];}
}
export function writeAuthCache(entries) {
  try {fs.writeFileSync(path.join(state.cacheDir, 'auth-cache.json'), JSON.stringify(entries, null, 2), 'utf-8');} catch {}
}
function removeAuthEntry(email) {
  const emailLower = normalizeEmail(email);
  const filtered = readAuthCache().filter((e) => !(e.email === emailLower && e.lodge_id === state.lodgeId));
  writeAuthCache(filtered);
}
function upsertAuthEntry(email, passwordHash) {
  const emailLower = normalizeEmail(email);
  const entries = readAuthCache().filter((e) => !(e.email === emailLower && e.lodge_id === state.lodgeId));
  entries.push({ email: emailLower, lodge_id: state.lodgeId, password_hash: passwordHash, deprecated: true });
  writeAuthCache(entries);
}

// ─── SESSION NONCE (anti-impersonation) ─────────────────────────────────────
// A random nonce generated on successful login, persisted to a file only the
// main process can read. restoreUserSession() requires the correct nonce to
// prove the renderer legitimately logged in on a prior run.
// Identity is derived from the nonce file — the renderer cannot influence it.

// Offline-first front desks need a trusted device session that survives normal
// connectivity gaps without rechecking a password against Supabase every week.
const SESSION_NONCE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function getSessionNoncePath() {
  return path.join(state.cacheDir, 'session-nonce.json');
}

function getTrustedSessionsPath() {
  return path.join(state.cacheDir, 'trusted-sessions.json');
}

function readSessionNonce() {
  try {return JSON.parse(fs.readFileSync(getSessionNoncePath(), 'utf-8'));}
  catch {return null;}
}

function readTrustedSessions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getTrustedSessionsPath(), 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTrustedSessions(sessions) {
  try {fs.writeFileSync(getTrustedSessionsPath(), JSON.stringify(sessions, null, 2), 'utf-8');} catch {}
}

function pruneExpiredTrustedSessions(sessions = readTrustedSessions()) {
  const now = Date.now();
  const active = sessions.filter((session) => {
    const createdAt = new Date(session?.createdAt || 0).getTime();
    return Number.isFinite(createdAt) && now - createdAt <= SESSION_NONCE_MAX_AGE_MS;
  });
  if (active.length !== sessions.length) writeTrustedSessions(active);
  return active;
}

function normalizeTrustedSessionRecord(record) {
  if (!record?.nonce) return null;
  return {
    ...record,
    userId: record.userId || record.id || null,
    id: record.id || record.userId || null,
    email: normalizeEmail(record.email),
    lodge_id: normalizeLodgeId(record.lodge_id || state.lodgeId),
    createdAt: record.createdAt || new Date().toISOString()
  };
}

function buildTrustedSessionRecord(user, nonce, password = '') {
  const session = getBackendSession();
  const normalizedUser = normalizeSessionUser(user);
  const record = normalizedUser && typeof normalizedUser === 'object' ?
  {
    id: normalizedUser.id || null,
    email: normalizedUser.email || null,
    name: normalizedUser.name || null,
    role: normalizedUser.role || null,
    lodge_id: normalizedUser.lodge_id || null,
    ...(Object.prototype.hasOwnProperty.call(normalizedUser, 'allowed_outlet_ids') ?
    { allowed_outlet_ids: normalizedUser.allowed_outlet_ids } :
    {}),
    isMasterAdmin: Boolean(normalizedUser.isMasterAdmin),
    session_token: session?.token || null,
    session_expires_at: session?.expires_at || null,
    session_type: session?.session_type || null
  } :
  {
    id: user || null,
    email: null,
    name: null,
    role: null,
    lodge_id: null,
    isMasterAdmin: false,
    session_token: session?.token || null,
    session_expires_at: session?.expires_at || null,
    session_type: session?.session_type || null
  };

  return {
    userId: record.id,
    ...record,
    nonce,
    createdAt: new Date().toISOString(),
    offline_password_hash: password ? bcrypt.hashSync(password, 10) : null
  };
}

function writeSessionNonce(user, nonce, password = '') {
  const record = buildTrustedSessionRecord(user, nonce, password);
  fs.writeFileSync(getSessionNoncePath(), JSON.stringify(record, null, 2), 'utf-8');

  const sessions = pruneExpiredTrustedSessions();
  const normalizedRecord = normalizeTrustedSessionRecord(record);
  if (!normalizedRecord?.id && !normalizedRecord?.email) return;
  const existing = sessions.find((session) => {
    const normalized = normalizeTrustedSessionRecord(session);
    return normalized && (
    normalizedRecord.id && normalized.id === normalizedRecord.id ||
    normalizedRecord.email && normalized.email === normalizedRecord.email);

  });
  const nextRecord = {
    ...(existing || {}),
    ...record,
    offline_password_hash: record.offline_password_hash || existing?.offline_password_hash || null
  };
  const next = sessions.filter((session) => {
    const normalized = normalizeTrustedSessionRecord(session);
    return !(normalized && (
    normalizedRecord.id && normalized.id === normalizedRecord.id ||
    normalizedRecord.email && normalized.email === normalizedRecord.email));

  });
  next.push(nextRecord);
  writeTrustedSessions(next);
}

export function clearSessionNonce() {
  try {fs.unlinkSync(getSessionNoncePath());} catch {/* file may not exist */}
}

export function createSessionNonce(user, password = '') {
  const nonce = crypto.randomBytes(32).toString('hex');
  writeSessionNonce(user, nonce, password);
  return nonce;
}

export function upsertCachedUser(user) {
  if (!user?.email) return;
  const normalizedUser = normalizeSessionUser(normalizeUserRecord(user));
  if (!normalizedUser?.id || !normalizedUser.email) return;
  const { password_hash: _ph, ...safeUser } = normalizedUser;
  const cached = readCache('users');
  const existing = cached.
  map(normalizeUserRecord).
  filter(Boolean);
  const previous = existing.find((entry) => entry.id === safeUser.id || entry.email === safeUser.email);
  const mergedUser = mergeSessionUserScope(previous, { ...safeUser, lodge_id: safeUser.lodge_id || state.lodgeId });
  const next = existing.filter((entry) => entry.id !== safeUser.id && entry.email !== safeUser.email);
  next.push(mergedUser);
  writeCache('users', next);
}

async function cacheSuccessfulLogin(user, emailLower, password = null) {
  console.log('[AUTH] cache write start:', { email: emailLower, userId: user?.id, lodge_id: state.lodgeId });
  if (typeof password === 'string' && password) {
    const localHash = await bcrypt.hash(password, 10); // legacy only, phased out by Supabase Auth
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

function getCachedUser(emailLower) {
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

function tryOfflineLogin(emailLower) {
  logAuthFailure('offline_password_login_disabled', { email: emailLower });
  return {
    user: null,
    code: 'offline_unlock_required',
    error:
    'Offline password sign-in is no longer supported. Open the app with the saved trusted session, or connect to the internet and sign in again.'
  };
}

function toSafeUser(user) {
  const {
    password_hash: _ph,
    session_token: _st,
    session_expires_at: _se,
    ...safeUser
  } = user;
  return safeUser;
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

async function fetchAuthenticateUserContract(emailLower) {
  try {
    const authClient = buildSupabaseClient(SUPABASE_ANON_KEY);
    authTrace('auth client state', getAuthClientState('anon-health-probe', null, emailLower));
    const rpcArgs = {
      p_email: emailLower,
      p_lodge_id: state.lodgeId,
      p_password: null, // health-check probe — no password, expect authenticated: false
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

async function getLodgeAuthContext(targetLodgeId = state.lodgeId) {
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

async function authenticateOnline(emailLower, password) {
  const supabaseAuth = await authenticateWithSupabaseAuth(emailLower, password);
  if (supabaseAuth.user || supabaseAuth.code !== 'supabase_auth_unavailable') {
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

async function createSupabaseAuthUserForStaff(emailLower, password) {
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

export async function sendPasswordResetEmail(email) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) throw new Error('Enter the email address for this account.');
  await checkOnline();
  if (!state.isOnline) throw new Error('Internet connection required to send a password reset email.');

  const authClient = buildSupabaseAuthClient();
  const options = getAuthRedirectUrl() ? { redirectTo: getAuthRedirectUrl() } : undefined;
  const { error } = await authClient.auth.resetPasswordForEmail(emailLower, options);
  if (error) throw new Error(error.message || 'Could not send password reset email.');
  return {
    success: true,
    email: emailLower,
    redirect_url_configured: Boolean(getAuthRedirectUrl())
  };
}

export async function sendUserInviteOrReset(id) {
  const user = await getUserById(id);
  if (!user) throw new Error('Staff account not found.');
  const emailLower = normalizeEmail(user.email);
  if (!emailLower) throw new Error('Staff account is missing an email address.');
  await checkOnline();
  if (!state.isOnline) throw new Error('Internet connection required to send staff invites.');

  if (!user.auth_user_id) {
    const admin = requireAdmin();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(emailLower, {
      data: {
        lodge_id: state.lodgeId,
        app_user_id: user.id,
        app: 'boroko-bookings'
      },
      redirectTo: getAuthRedirectUrl()
    });
    if (error) throw new Error(error.message || 'Could not send staff invite.');
    const authUserId = data?.user?.id || null;
    if (authUserId) {
      const { error: linkError } = await admin.
      from('users').
      update({ auth_user_id: authUserId }).
      eq('id', user.id).
      eq('lodge_id', state.lodgeId);
      if (linkError) throw new Error(linkError.message || 'Invite sent, but the staff account could not be linked.');
      upsertCachedUser({ ...user, auth_user_id: authUserId });
    }
    logActivity('staff_invite_sent', `${user.name || emailLower} · Supabase Auth invite sent`);
    return {
      success: true,
      mode: 'invite',
      email: emailLower,
      auth_user_id: authUserId,
      redirect_url_configured: Boolean(getAuthRedirectUrl())
    };
  }

  const result = await sendPasswordResetEmail(emailLower);
  logActivity('staff_password_reset_sent', `${user.name || emailLower} · password reset email sent`);
  return {
    ...result,
    mode: 'reset'
  };
}

/**
 * Always tries Supabase Auth first (authoritative). The older authenticate_user RPC is
 * retained as a temporary migration fallback for accounts not yet linked to auth.users.
 * Offline password verification is intentionally disabled; offline reopen uses the
 * trusted session nonce created after a successful online sign-in.
 *
 * @returns {{ user: object | null, error?: string }}
 */
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
      // Fetch outlet access for cashier/supervisor roles (non-breaking — new field)
      try {
        const { data: outletAccess } = await state.supabase.rpc('get_user_outlet_access', {
          p_user_id: online.user.id,
          p_lodge_id: state.lodgeId
        });
        if (outletAccess) {
          online.user.allowed_outlet_ids = outletAccess.allowed_outlet_ids || [];
        }
      } catch {
        // Non-critical — default to empty array if RPC not yet deployed
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

function getMonthWindowIso(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const dateStart = start.toISOString().slice(0, 10);
  const dateEnd = end.toISOString().slice(0, 10);
  return { start: start.toISOString(), end: end.toISOString(), dateStart, dateEnd, startDate: start, endDate: end };
}

function resolveQueuedItemCreatedAtRaw(item = {}) {
  return (
    item?.timestamp ||
    item?.createdAt ||
    item?.created_at ||
    item?.queued_at ||
    item?.data?.created_at_client ||
    item?.data?.payload?.created_at_client ||
    item?.data?.createdAt ||
    item?.data?.created_at ||
    item?.data?.queued_at ||
    new Date().toISOString());

}

function getPendingUsageQueueCounts({ targetMonthDate = new Date(), creationMonthDate = new Date() } = {}) {
  const queue = readSyncQueue();
  const { startDate, endDate } = getMonthWindowIso(targetMonthDate);
  const creationWindow = getMonthWindowIso(creationMonthDate);
  let pendingTargetMonthBookings = 0;
  let pendingCreationMonthBookings = 0;
  let pendingRooms = 0;
  let pendingUsers = 0;
  for (const item of queue) {
    if (item?.type !== 'rpc') continue;
    if (item?.table === 'create_booking') {
      const status = String(item?.data?.p_status || item?.data?.payload?.status || 'confirmed').toLowerCase();
      if (!['confirmed', 'checked_in', 'checked_out'].includes(status)) continue;
      if (item?.data?.payload?.is_exclusive_event === true || item?.data?.p_is_exclusive_event === true) continue;
      const checkInRaw = item?.data?.p_check_in || item?.data?.payload?.check_in;
      const checkIn = new Date(checkInRaw || 0);
      if (!Number.isFinite(checkIn.getTime())) continue;
      const createdAtRaw = resolveQueuedItemCreatedAtRaw(item);
      const createdAt = new Date(createdAtRaw);
      if (checkIn >= startDate && checkIn < endDate) pendingTargetMonthBookings += 1;
      if (Number.isFinite(createdAt.getTime()) && createdAt >= creationWindow.startDate && createdAt < creationWindow.endDate) {
        pendingCreationMonthBookings += 1;
      }
    } else if (item?.table === 'create_room') {
      pendingRooms += 1;
    } else if (item?.table === 'create_user') {
      pendingUsers += 1;
    }
  }
  return { pendingTargetMonthBookings, pendingCreationMonthBookings, pendingRooms, pendingUsers };
}

function getCachedMonthlyBookingUsage(now = new Date()) {
  return countMonthlyUsageBookings(readCache('bookings'), now);
}

function getCachedCreatedBookingUsage(now = new Date()) {
  return countMonthlyCreatedBookings(readCache('bookings'), now);
}

function getCachedEntityUsageCounts({ targetMonthDate = new Date(), creationMonthDate = new Date() } = {}) {
  const pending = getPendingUsageQueueCounts({ targetMonthDate, creationMonthDate });
  const targetMonthBookings = getCachedMonthlyBookingUsage(targetMonthDate) + pending.pendingTargetMonthBookings;
  const creationMonthBookings = getCachedCreatedBookingUsage(creationMonthDate) + pending.pendingCreationMonthBookings;
  return {
    monthlyBookings: targetMonthBookings,
    targetMonthBookings,
    creationMonthBookings,
    rooms: readCache('rooms').length + pending.pendingRooms,
    users: readCache('users').length + pending.pendingUsers
  };
}

function buildUsageSummary(plan, limits, usage, source) {
  const bookingAllowance = evaluateBookingCreationAllowance({
    plan,
    targetMonthUsed: usage.targetMonthBookings,
    createdMonthUsed: usage.creationMonthBookings
  });
  const roomStatus = canCreateRoom({ plan, used: usage.rooms });
  const userStatus = canCreateUser({ plan, used: usage.users });
  const recommendation = getPlanRecommendation({
    plan,
    bookingsUsage: usage.targetMonthBookings ?? usage.monthlyBookings,
    roomsUsage: usage.rooms,
    usersUsage: usage.users,
    limits
  });

  return {
    plan,
    limits,
    usage,
    source,
    statuses: {
      bookings: bookingAllowance.combinedStatus,
      bookingTargetMonth: bookingAllowance.targetMonthStatus,
      bookingCreationMonth: bookingAllowance.creationMonthStatus,
      rooms: roomStatus,
      users: userStatus
    },
    bookingAllowance,
    recommendation,
    monthlyResetCopy: MONTHLY_USAGE_RESET_COPY
  };
}

export async function getCreationUsageSummary(targetLodgeId = state.lodgeId, { monthDate = new Date(), creationMonthDate = new Date(), forceRemoteRefresh = false } = {}) {
  const entitlement = await getTrialStatus(targetLodgeId).catch(() => null);
  const plan = normalizeSubscriptionPlan(entitlement?.plan || 'Starter');
  const limits = getPlanUsageLimits(plan);
  if (!state.isOnline && !forceRemoteRefresh || !targetLodgeId) {
    const usage = getCachedEntityUsageCounts({ targetMonthDate: monthDate, creationMonthDate });
    return { ...buildUsageSummary(plan, limits, usage, 'cache'), lastUsageSyncAt: state.lastUsageSyncAt };
  }

  const { dateStart, dateEnd } = getMonthWindowIso(monthDate);
  const creationWindow = getMonthWindowIso(creationMonthDate);
  const [bookingsResult, createdBookingsResult, roomsResult, usersResult] = await Promise.all([
  state.supabase.
  from('bookings').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId).
  in('status', ['confirmed', 'checked_in', 'checked_out']).
  neq('is_exclusive_event', true).
  gte('check_in', dateStart).
  lt('check_in', dateEnd),
  state.supabase.
  from('bookings').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId).
  in('status', ['confirmed', 'checked_in', 'checked_out']).
  neq('is_exclusive_event', true).
  gte('created_at', creationWindow.start).
  lt('created_at', creationWindow.end),
  state.supabase.
  from('rooms').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId),
  state.supabase.
  from('users').
  select('id', { count: 'exact', head: true }).
  eq('lodge_id', targetLodgeId)]
  );

  if (bookingsResult.error || createdBookingsResult.error || roomsResult.error || usersResult.error) {
    const usage = getCachedEntityUsageCounts({ targetMonthDate: monthDate, creationMonthDate });
    return { ...buildUsageSummary(plan, limits, usage, 'cache'), lastUsageSyncAt: state.lastUsageSyncAt };
  }

  state.lastUsageSyncAt = new Date().toISOString();
  return {
    ...buildUsageSummary(plan, limits, {
      monthlyBookings: Number(bookingsResult.count || 0),
      targetMonthBookings: Number(bookingsResult.count || 0),
      creationMonthBookings: Number(createdBookingsResult.count || 0),
      rooms: Number(roomsResult.count || 0),
      users: Number(usersResult.count || 0)
    }, 'remote'),
    lastUsageSyncAt: state.lastUsageSyncAt
  };
}

function usageLimitErrorMessage(resource, summary) {
  const plan = summary.plan;
  const limits = summary.limits;
  if (resource === 'booking') {
    if (summary.bookingAllowance?.blockReason === 'creation_month') {
      return `Monthly booking creation limit reached for this plan. Upgrade to continue creating future bookings.`;
    }
    return `Booking limit reached for the selected check-in month.`;
  }

  const nextPlan = getNextSubscriptionPlan(plan);
  if (resource === 'room') {
    if (summary.statuses?.rooms?.isAbovePlan) {
      return `This lodge is above the ${plan} plan room limit. Existing rooms remain available, but new rooms are restricted until usage is reduced or the plan is upgraded.`;
    }
    return `Room limit reached: ${plan} allows up to ${limits?.rooms} rooms. Upgrade to ${nextPlan} for more rooms.`;
  }
  if (summary.statuses?.users?.isAbovePlan) {
    return `This lodge is above the ${plan} plan user limit. Existing staff remain available, but new users are restricted until usage is reduced or the plan is upgraded.`;
  }
  return `User limit reached: ${plan} allows up to ${limits?.users} staff accounts. Upgrade to ${nextPlan} for more users.`;
}

export function buildUsageWarning(summary) {
  if (!summary) return '';
  const plan = summary.plan;
  if (summary.statuses?.rooms?.isAbovePlan || summary.statuses?.users?.isAbovePlan || summary.statuses?.bookings?.isBlocked) {
    return `This lodge is above the ${plan} plan limits. Existing records remain available, but new records are restricted until usage is reduced or the plan is upgraded.`;
  }
  if (summary.bookingAllowance?.creationMonthStatus?.isBlocked) {
    return 'Monthly booking creation limit reached for this plan. Upgrade to continue creating future bookings.';
  }
  if (summary.bookingAllowance?.targetMonthStatus?.isBlocked) {
    return 'Booking limit reached for the selected check-in month.';
  }
  if (summary.bookingAllowance?.combinedStatus?.isInGrace) {
    return 'You have reached the monthly booking limit and are using grace bookings. Upgrade now to avoid interruptions.';
  }
  return '';
}

export async function assertCreationWithinUsageLimit(resource, options = {}) {
  const targetMonthDate = options.targetMonthDate || options.monthDate || new Date();
  const creationMonthDate = options.creationMonthDate || new Date();
  const summary = await getCreationUsageSummary(state.lodgeId, {
    monthDate: targetMonthDate,
    creationMonthDate,
    forceRemoteRefresh: options.forceRemoteRefresh === true
  });
  const status = resource === 'booking' ?
  summary.bookingAllowance?.combinedStatus :
  resource === 'room' ?
  summary.statuses?.rooms :
  summary.statuses?.users;

  const blocked = resource === 'booking' ?
  summary.bookingAllowance?.isBlocked :
  status?.isBlocked;

  if (blocked) {
    throw new Error(usageLimitErrorMessage(resource, summary));
  }

  summary.status = status;
  summary.warning = buildUsageWarning(summary);
  return summary;
}

// ─── USERS ────────────────────────────────────────────────────────────────────

export async function getAllUsers() {
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('users').
    select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash').
    eq('lodge_id', state.lodgeId).
    order('name');
    const normalized = (data || []).map(normalizeUserRecord).filter(Boolean);
    if (data) writeCache('users', normalized);
    return normalized.map(sanitizeUserForRenderer);
  }
  return readCache('users').map(normalizeUserRecord).filter(Boolean).map(sanitizeUserForRenderer);
}

export async function getUsers() {
  return getAllUsers();
}

export async function getUserById(id) {
  if (!id) return null;
  try {
    const { data, error } = await state.supabase.
    from('users').
    select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash').
    eq('id', id).
    eq('lodge_id', state.lodgeId).
    single();
    if (error) throw error;
    return sanitizeUserForRenderer(normalizeUserRecord(data));
  } catch {
    const user = readCache('users').map(normalizeUserRecord).filter(Boolean).find((entry) => entry.id === id) || null;
    return sanitizeUserForRenderer(user);
  }
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
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'healthCheck_get_lodge_auth_context',
      message: e.message || null
    });
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
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_settings_contract_invalid', health });
    authTrace('healthCheck return', health);
    return health;
  }

  const probeEmail = emailLower || '__auth_health_check__@invalid.local';
  const { rpcResult, contract } = await fetchAuthenticateUserContract(probeEmail);
  if (rpcResult?.error) {
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'healthCheck_authenticate_user_rpc',
      message: rpcResult.error.message || null
    });
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
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_authenticate_user_contract_invalid', contract });
    authTrace('healthCheck return', health);
    return health;
  }

  const probeRow = contract.row;
  if (normalizeLodgeId(probeRow.lodge_id) !== normalizeLodgeId(state.lodgeId)) {
    health.code = 'backend_auth_schema_outdated';
    health.error = 'The canonical authenticate_user function returned a lodge_id that does not match this device.';
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_authenticate_user_lodge_mismatch', probeRow, lodgeId: state.lodgeId });
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
      console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_expected_user_mismatch', probeRow, expectedUserId });
      authTrace('healthCheck return', health);
      return health;
    }
    if (probeRow.email !== emailLower) {
      health.code = 'backend_auth_schema_outdated';
      health.error = 'The canonical authenticate_user function returned a user that does not match the requested lodge-scoped email.';
      console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_email_mismatch', probeRow, emailLower });
      authTrace('healthCheck return', health);
      return health;
    }
  } else if (probeRow.found) {
    health.code = 'backend_auth_schema_outdated';
    health.error = 'The canonical authenticate_user function unexpectedly returned a user during the health-check probe.';
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_unexpected_probe_user', probeRow });
    authTrace('healthCheck return', health);
    return health;
  }

  health.checks.authenticate_user_contract_valid = true;
  health.ok = true;
  health.code = 'ok';
  console.log('[AUTH HEALTH] success:', {
    email: emailLower || null,
    lodge_id: state.lodgeId,
    user_id: health.user?.id || null
  });
  authTrace('healthCheck return', health);
  return health;
}

function resolvePwaAccessUpdate(existingUser = {}, data = {}) {
  const hasToggle = Object.prototype.hasOwnProperty.call(data, 'pwa_enabled');
  const hasReason = Object.prototype.hasOwnProperty.call(data, 'pwa_disabled_reason');
  const nextRole = normalizeStaffRole(data.role || existingUser?.role);
  const nextPassword = typeof data.pwa_password === 'string' ? data.pwa_password.trim() : '';
  const hasPassword = Boolean(nextPassword);
  const autoDisableForRole = Boolean(existingUser?.pwa_enabled) && Object.prototype.hasOwnProperty.call(data, 'role') && !isPwaEligibleRole(nextRole);
  const requested = hasToggle || hasReason || hasPassword || autoDisableForRole;

  if (!requested) {
    return { requested: false };
  }

  const enabled = autoDisableForRole ?
  false :
  hasToggle ?
  data.pwa_enabled === true :
  existingUser?.pwa_enabled === true;

  if (enabled && !isPwaEligibleRole(nextRole)) {
    throw createAppError('pwa_role_ineligible', PWA_ROLE_DISABLED_MESSAGE, { role: nextRole });
  }

  const password_hash = hasPassword ? bcrypt.hashSync(nextPassword, 10) : null;
  const hasExistingPassword = Boolean(existingUser?.pwa_password_set_at || existingUser?.pwa_password_hash);
  if (enabled && !password_hash && !hasExistingPassword) {
    throw createAppError('pwa_password_required', 'Set a separate manager mobile app password before enabling access.');
  }

  return {
    requested: true,
    enabled,
    password_hash,
    autoDisableForRole,
    disabled_reason: enabled ?
    null :
    normalizePwaDisabledReason(
      autoDisableForRole ? PWA_ROLE_DISABLED_MESSAGE : data.pwa_disabled_reason,
      autoDisableForRole ? PWA_ROLE_DISABLED_MESSAGE : PWA_DISABLED_MESSAGE
    )
  };
}

function buildPwaAccessInput(data = {}, fallbackRole = null) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(data, 'pwa_enabled')) {
    payload.pwa_enabled = data.pwa_enabled;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'pwa_disabled_reason')) {
    payload.pwa_disabled_reason = data.pwa_disabled_reason;
  }
  if (typeof data.pwa_password === 'string') {
    payload.pwa_password = data.pwa_password;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'role')) {
    payload.role = data.role;
  } else if (fallbackRole) {
    payload.role = fallbackRole;
  }

  return payload;
}

export async function createUser(data) {
  await assertCreationWithinUsageLimit('user', { forceRemoteRefresh: state.isOnline });
  const emailLower = data.email.trim().toLowerCase();

  // ── Duplicate email check ─────────────────────────────────────────────────
  // Admin/super_admin emails are globally unique (one per system — they own the lodge setup).
  // All other roles (employees) can have accounts across multiple lodges.
  const isSetupRole = ['admin', 'super_admin'].includes(normalizeStaffRole(data.role));
  if (state.isOnline) {
    const query = state.supabase.from('users').select('id').eq('email', emailLower);
    if (!isSetupRole) query.eq('lodge_id', state.lodgeId);
    const { data: existing } = await query.limit(1);
    if (existing && existing.length > 0) {
      const msg = isSetupRole ?
      `An admin account with the email "${emailLower}" already exists. Each admin email can only be registered to one lodge.` :
      `A user with the email "${emailLower}" already exists in this lodge.`;
      throw new Error(msg);
    }
  } else {
    const cached = readCache('users');
    const duplicate = isSetupRole ?
    cached.some((u) => u.email?.toLowerCase() === emailLower) :
    cached.some((u) => u.email?.toLowerCase() === emailLower && u.lodge_id === state.lodgeId);
    if (duplicate) {
      const msg = isSetupRole ?
      `An admin account with the email "${emailLower}" already exists. Each admin email can only be registered to one lodge.` :
      `A user with the email "${emailLower}" already exists in this lodge.`;
      throw new Error(msg);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const hash = bcrypt.hashSync(data.password, 10);
  const pwaAccess = resolvePwaAccessUpdate({}, data);
  const id = randomUUID();
  const authUserId = state.isOnline ?
  await createSupabaseAuthUserForStaff(emailLower, data.password) :
  null;
  const user = {
    id,
    auth_user_id: authUserId,
    name: data.name,
    email: emailLower,
    password_hash: hash,
    role: normalizeStaffRole(data.role),
    lodge_id: state.lodgeId,
    pwa_enabled: pwaAccess.enabled === true,
    pwa_password_hash: pwaAccess.password_hash,
    pwa_password_set_at: pwaAccess.password_hash ? new Date().toISOString() : null,
    pwa_password_reset_by: pwaAccess.password_hash ? state.currentUser?.id || null : null,
    pwa_disabled_reason: pwaAccess.enabled === true ? null : pwaAccess.requested ? pwaAccess.disabled_reason : null,
    allowed_outlet_ids: Array.isArray(data.allowed_outlet_ids) ? data.allowed_outlet_ids : []
  };
  if (data.pin) {
    user.pin_hash = bcrypt.hashSync(String(data.pin).trim(), 10);
  }

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_user', { payload: user });
    if (error) {
      console.error('[USERS] createUser insert failed:', {
        email: emailLower,
        lodge_id: state.lodgeId,
        error: error.message
      });
      const code = isBackendAuthSchemaError(error.message || '') ?
      'backend_auth_schema_outdated' :
      'user_create_failed';
      const prefix = code === 'backend_auth_schema_outdated' ?
      'This database is missing the latest Boroko auth schema required to create staff accounts for a lodge.' :
      'Could not create the staff account for this lodge.';
      throw createAppError(code, `${prefix} ${error.message}`.trim(), { email: emailLower, lodge_id: state.lodgeId });
    }
    if (!result?.success || !result?.id) {
      throw createAppError(
        'user_create_failed',
        result?.error || 'Supabase did not return the new staff account after insert.',
        { email: emailLower, lodge_id: state.lodgeId }
      );
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
      lodge_id: user.lodge_id,
      pin_hash: user.pin_hash || null,
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
        lodge_id: user.lodge_id,
        pin_hash: user.pin_hash || null,
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
    return result?.id;
  } else {
    const cached = readCache('users');

    const newUser = {
      ...user,
      created_at: new Date().toISOString()
    };

    cached.push(newUser);
    writeCache('users', cached);

    // IMPORTANT: send ID to Supabase too
    // P2-15: assign _queue_id so pwa_access setup can declare an explicit dependency
    queueOperation('rpc', 'create_user', { payload: newUser }, null, { _queue_id: `user-${id}` });
    if (pwaAccess.requested) {
      // P2-15: must not run before the user row exists on the server
      queueOperation('rpc', 'set_user_pwa_access', {
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

    return id;
  }
}

export async function updateUser(id, data) {
  const cachedUsers = readCache('users');
  const existingUser = cachedUsers.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  const update = {};
  if (Object.prototype.hasOwnProperty.call(data, 'name')) update.name = data.name;
  if (Object.prototype.hasOwnProperty.call(data, 'email') && data.email) update.email = data.email.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(data, 'role')) update.role = normalizeStaffRole(data.role);
  if (Object.prototype.hasOwnProperty.call(data, 'allowed_outlet_ids')) {
    update.allowed_outlet_ids = Array.isArray(data.allowed_outlet_ids) ? data.allowed_outlet_ids : [];
  }
  const password_hash = data.password ? bcrypt.hashSync(data.password, 10) : null;
  if (data.pin) {
    update.pin_hash = bcrypt.hashSync(String(data.pin).trim(), 10);
  }
  const pwaAccess = resolvePwaAccessUpdate(existingUser, buildPwaAccessInput(data));

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
      queueOperation('rpc', 'update_user_profile', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        payload: update
      });
    }
    if (password_hash) {
      queueOperation('rpc', 'set_user_password', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        p_password_hash: password_hash
      });
    }
    if (pwaAccess.requested) {
      queueOperation('rpc', 'set_user_pwa_access', {
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
}

export async function resetUserPassword(id, password) {
  const users = state.isOnline ? await getAllUsers() : readCache('users');
  const existingUser = users.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
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
    queueOperation('rpc', 'set_user_password', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_password_hash: password_hash
    });
  }

  if (state.isOnline && existingUser.auth_user_id && state.adminDb) {
    const { error } = await state.adminDb.auth.admin.updateUserById(existingUser.auth_user_id, {
      password
    });
    if (error) throw new Error(error.message || 'Could not update Supabase Auth password.');
  }

  upsertAuthEntry(existingUser.email.trim().toLowerCase(), bcrypt.hashSync(password, 10));
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
  const users = state.isOnline ? await getAllUsers() : readCache('users').map(normalizeUserRecord).filter(Boolean);
  const existingUser = users.find((u) => u.id === id);
  if (!existingUser) throw new Error('Staff account not found.');
  if (state.currentUser?.id === id) throw new Error('You cannot delete the account you are currently signed in with.');

  if (normalizeStaffRole(existingUser.role) === 'admin') {
    const adminCount = users.filter((u) => normalizeStaffRole(u.role) === 'admin').length;
    if (adminCount <= 1) {
      throw new Error('You cannot delete the last admin in this lodge.');
    }
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
    queueOperation('rpc', 'delete_user', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
  }
}

// ─── ROOMS ────────────────────────────────────────────────────────────────────

async function getAllRooms() {
  return (await import('./' + 'rooms.js')).getAllRooms()
}

async function getRoomById(id) {
  return (await import('./' + 'rooms.js')).getRoomById(id)
}

async function createRoom(data) {
  return (await import('./' + 'rooms.js')).createRoom(data)
}

async function updateRoom(id, data) {
  return (await import('./' + 'rooms.js')).updateRoom(id, data)
}

async function updateRoomHousekeeping(id, status, notes) {
  return (await import('./' + 'rooms.js')).updateRoomHousekeeping(id, status, notes)
}

async function deleteRoom(id) {
  return (await import('./' + 'rooms.js')).deleteRoom(id)
}

async function getAllCustomers() {
  return (await import('./' + 'customers.js')).getAllCustomers()
}

async function createCustomer(data) {
  return (await import('./' + 'customers.js')).createCustomer(data)
}

async function updateCustomerBlacklist(id, is_blacklisted, reason) {
  return (await import('./' + 'customers.js')).updateCustomerBlacklist(id, is_blacklisted, reason)
}

async function getCustomerBookings(customerId) {
  return (await import('./' + 'customers.js')).getCustomerBookings(customerId)
}

async function updateCustomer(id, data) {
  return (await import('./' + 'customers.js')).updateCustomer(id, data)
}

async function updateCustomerIdPhoto(id, photo) {
  return (await import('./' + 'customers.js')).updateCustomerIdPhoto(id, photo)
}

async function getCustomerById(id) {
  return (await import('./' + 'customers.js')).getCustomerById(id)
}

// ─── CUSTOMERS ────────────────────────────────────────────────────────────────

async function getAllBookings(...args) {
  return (await import('./' + 'bookings.js')).getAllBookings(...args);
}

async function getAllQuotations(...args) {
  return (await import('./' + 'bookings.js')).getAllQuotations(...args);
}

async function getBookingInvoices(...args) {
  return (await import('./' + 'bookings.js')).getBookingInvoices(...args);
}

async function createBooking(...args) {
  return (await import('./' + 'bookings.js')).createBooking(...args);
}

async function updateBookingPayment(...args) {
  return (await import('./' + 'bookings.js')).updateBookingPayment(...args);
}

// ─── BOOKINGS ─────────────────────────────────────────────────────────────────

export function mergeRemoteBookingsWithLocalState(remoteRows = [], localRows = readCache('bookings')) {
  const remoteIds = new Set((remoteRows || []).map((row) => row?.id).filter(Boolean));
  const protectedLocalRows = (localRows || []).filter((row) =>
  row?._pending_sync ||
  row?._pending_payment ||
  ['pending', 'failed', 'sync_failed', 'manual_review_required'].includes(String(row?._sync_state || ''))
  );
  const localOnlyRows = protectedLocalRows.filter((row) => row?.id && !remoteIds.has(row.id));
  return [...localOnlyRows, ...(remoteRows || [])];
}

// ── BOOKING VALIDATION HELPERS ───────────────────────────────────────────────

export async function checkExclusiveEventConflict(checkIn, checkOut, excludeGroupId = null) {
  if (state.isOnline) {
    const { data } = await state.supabase.from('bookings').select('id, notes').
    eq('lodge_id', state.lodgeId).
    eq('is_exclusive_event', true).
    neq('status', 'cancelled').
    lt('check_in', checkOut).
    gt('check_out', checkIn);
    if (data?.length > 0) {
      if (excludeGroupId && data.every((b) => b.notes?.includes(`[GROUP:${excludeGroupId}]`))) return;
      throw new Error('The lodge is fully reserved for an exclusive event on these dates. No other bookings can be made.');
    }
  } else {
    const events = readCache('bookings').filter((b) =>
    b.is_exclusive_event && b.status !== 'cancelled' &&
    b.check_in < checkOut && b.check_out > checkIn &&
    !(excludeGroupId && b.notes?.includes(`[GROUP:${excludeGroupId}]`))
    );
    if (events.length > 0)
    throw new Error('The lodge is fully reserved for an exclusive event on these dates. No other bookings can be made.');
  }
}

const VALID_STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled'],
  checked_in: ['checked_out']
};

function normalizeRpcProbeEnvelope(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data && typeof data === 'object' ? data : null;
}

function isReplayContractProbeFailure(message = '') {
  return /PGRST202|42883|could not find the function|function.*does not exist|function.*not.*found|schema cache|structure of query does not match|returned record type does not match expected record type|unexpected parameter|missing required|has no parameter named|column .* does not exist/i.test(String(message || ''));
}

// P0-7: probe replay-critical RPCs with the current argument names used by the app.
// Missing/shape-mismatched contracts must fail health, while ordinary business-rule
// rejections still count as "function exists and is callable with this signature".
async function probeRpc(name, args = {}, options = {}) {
  const { expectSuccessEnvelope = true } = options;
  try {
    const { data, error } = await state.supabase.rpc(name, args);
    if (error) {
      const message = error.message || 'Unknown error';
      if (isReplayContractProbeFailure(message) || error.code === 'PGRST202') {
        return { ok: false, message: `${name} contract mismatch — ${message}` };
      }
      return { ok: true, message: `${name} is callable (probe reached runtime validation).`, responseShapeVerified: false };
    }

    if (!expectSuccessEnvelope) {
      return { ok: true, message: `${name} is available.`, responseShapeVerified: false };
    }

    const envelope = normalizeRpcProbeEnvelope(data);
    if (!envelope || typeof envelope !== 'object' || !Object.prototype.hasOwnProperty.call(envelope, 'success')) {
      return { ok: false, message: `${name} returned an unexpected response shape.` };
    }
    return { ok: true, message: `${name} returned the expected response shape.`, responseShapeVerified: true };
  } catch (e) {
    return { ok: false, message: `${name} probe threw: ${e.message}` };
  }
}

export async function getSystemHealth() {
  const diagnostics = await getLodgeDiagnostics(state.lodgeId || '').catch((error) => ({ error: error.message }));
  const sync = getSyncStatus();
  const backups = getBackupInfoForHealth();
  const backup_health = getBackupHealthSummary(backups);
  const faults = readHealthFaults();
  const finance = {
    payments_rpc: { ok: false, message: 'Offline or not checked yet.' },
    contract: { ok: false, probes: {}, allOk: false, message: 'Not checked yet.' }
  };

  await checkOnline();
  if (state.isOnline && state.lodgeId) {
    // Existing payment ledger check
    try {
      const { error } = await state.supabase.rpc('get_booking_payments', {
        p_booking_id: randomUUID(),
        p_lodge_id: state.lodgeId
      });
      if (error) throw error;
      finance.payments_rpc = { ok: true, message: 'Booking payment ledger RPC is available.' };
    } catch (e) {
      finance.payments_rpc = {
        ok: false,
        message: /get_booking_payments/i.test(e.message || '') ?
        'Booking payment ledger RPC is missing. Run the latest checked-in finance migration.' :
        e.message || 'Could not verify booking payment ledger RPC.'
      };
    }

    // P0-7: probe all replay-critical RPCs
    const probeBookingId = randomUUID();
    const probeCustomerId = randomUUID();
    const probeRoomId = randomUUID();
    const probeChargeId = randomUUID();
    const probePosOrderId = randomUUID();
    const probeNow = new Date().toISOString();
    const probeInvoiceNumber = `PROBE-${Date.now()}`;
    const probeBookingPayload = {
      id: probeBookingId,
      customer_id: probeCustomerId,
      room_id: probeRoomId,
      check_in: '2099-12-01',
      check_out: '2099-12-02',
      adults: 1,
      children: 0,
      total_amount: 1,
      status: 'confirmed',
      payment_status: 'unpaid',
      amount_paid: 0,
      deposit_amount: 0,
      payment_method: null,
      invoice_number: probeInvoiceNumber,
      notes: 'contract probe',
      created_by: state.currentUser?.id || null,
      lodge_id: state.lodgeId,
      deposit_method: null,
      create_idempotency_key: createBookingIdempotencyKey(probeBookingId)
    };
    const rpcProbes = await Promise.all([
    probeRpc('create_booking', {
      p_lodge_id: state.lodgeId,
      p_customer_id: probeCustomerId,
      p_room_id: probeRoomId,
      p_check_in: probeBookingPayload.check_in,
      p_check_out: probeBookingPayload.check_out,
      p_adults: probeBookingPayload.adults,
      p_children: probeBookingPayload.children,
      p_total_amount: probeBookingPayload.total_amount,
      p_invoice_number: probeInvoiceNumber,
      p_notes: probeBookingPayload.notes,
      p_created_by: state.currentUser?.id || null,
      p_deposit_amount: 0,
      p_booking_id: probeBookingId,
      p_idempotency_key: createBookingIdempotencyKey(probeBookingId),
      p_deposit_method: null,
      p_allow_total_override: false
    }).then((r) => ['create_booking', r]),
    probeRpc('create_booking_record', {
      payload: probeBookingPayload
    }).then((r) => ['create_booking_record', r]),
    probeRpc('update_booking', {
      p_id: probeBookingId,
      p_lodge_id: state.lodgeId,
      payload: {
        notes: 'contract probe',
        expected_updated_at: probeNow
      },
      p_expected_updated_at: probeNow
    }).then((r) => ['update_booking', r]),
    probeRpc('update_booking_status', {
      p_id: probeBookingId,
      p_lodge_id: state.lodgeId,
      p_status: 'confirmed',
      p_expected_updated_at: probeNow
    }).then((r) => ['update_booking_status', r]),
    probeRpc('update_booking_payment', {
      p_booking_id: probeBookingId,
      p_lodge_id: state.lodgeId,
      p_amount: 1,
      p_method: 'cash',
      p_type: 'payment',
      p_idempotency_key: `probe:payment:${probeBookingId}`,
      p_recorded_by: state.currentUser?.id || null,
      p_expected_updated_at: probeNow
    }).then((r) => ['update_booking_payment', r]),
    probeRpc('create_pos_order', {
      payload: {
        lodge_id: state.lodgeId,
        id: probePosOrderId,
        room_id: probeRoomId,
        booking_id: null,
        walk_in_name: 'Contract Probe',
        total: 1,
        notes: 'contract probe',
        payment_method: 'folio',
        outlet_id: null,
        create_idempotency_key: `probe:pos:${probePosOrderId}`,
        created_at_client: probeNow,
        items: [
        { menu_item_id: null, item_name: 'Contract Probe', quantity: 1, unit_price: 1 }]

      }
    }).then((r) => ['create_pos_order', r]),
    probeRpc('add_booking_charge', {
      p_booking_id: probeBookingId,
      p_lodge_id: state.lodgeId,
      p_description: 'Contract probe',
      p_category: 'other',
      p_quantity: 1,
      p_unit_price: 1,
      p_outlet_id: null,
      p_expected_updated_at: probeNow
    }).then((r) => ['add_booking_charge', r]),
    probeRpc('delete_booking_charge', {
      p_charge_id: probeChargeId,
      p_lodge_id: state.lodgeId,
      p_reason: 'contract probe',
      p_expected_booking_updated_at: probeNow
    }).then((r) => ['delete_booking_charge', r])]
    );
    const probesObj = Object.fromEntries(rpcProbes);
    const allOk = Object.values(probesObj).every((p) => p.ok);
    const missing = Object.entries(probesObj).filter(([, p]) => !p.ok).map(([name]) => name);
    finance.contract = {
      ok: allOk,
      probes: probesObj,
      allOk,
      message: allOk ?
      'All replay-critical RPCs are available.' :
      `Missing RPCs: ${missing.join(', ')} — run the latest migrations before trusting replay.`
    };
  }

  return {
    checked_at: new Date().toISOString(),
    lodge_id: state.lodgeId,
    online: state.isOnline,
    replayAuthReady: state.replayAuthReady,
    sync,
    backups,
    backup_health,
    diagnostics,
    finance,
    faults
  };
}

// ─── EVENT / LODGE BOOKING ────────────────────────────────────────────────────

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

// ─── BOOKING CHARGES (FOLIO) ──────────────────────────────────────────────────

// ─── RATE OVERRIDES (SEASONAL / WEEKEND PRICING) ──────────────────────────────

async function getExpenses(startDate, endDate, outletId = 'all') {
  return (await import('./' + 'expenses.js')).getExpenses(startDate, endDate, outletId)
}

async function getExpenseById(id) {
  return (await import('./' + 'expenses.js')).getExpenseById(id)
}

async function createExpense(data) {
  return (await import('./' + 'expenses.js')).createExpense(data)
}

async function updateExpense(id, data) {
  return (await import('./' + 'expenses.js')).updateExpense(id, data)
}

async function deleteExpense(id) {
  return (await import('./' + 'expenses.js')).deleteExpense(id)
}

async function getAdminExpenses() {
  return (await import('./' + 'expenses.js')).getAdminExpenses()
}

async function createAdminExpense(data) {
  return (await import('./' + 'expenses.js')).createAdminExpense(data)
}

async function updateAdminExpense(id, data) {
  return (await import('./' + 'expenses.js')).updateAdminExpense(id, data)
}

async function deleteAdminExpense(id) {
  return (await import('./' + 'expenses.js')).deleteAdminExpense(id)
}

// ─── EXPENSES ─────────────────────────────────────────────────────────────────

// ─── MAINTENANCE TICKETS ──────────────────────────────────────────────────────

async function getMaintenanceTickets() {
  return (await import('./' + 'maintenance.js')).getMaintenanceTickets()
}

async function getMaintenanceRowsForPeriod(startDate, endDate) {
  return (await import('./' + 'maintenance.js')).getMaintenanceRowsForPeriod(startDate, endDate)
}

// ─── ID PHOTO ─────────────────────────────────────────────────────────────────

// ─── FORECAST ─────────────────────────────────────────────────────────────────

// ─── POS (POINT OF SALE) ──────────────────────────────────────────────────────

function normalizeInventoryStockValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolveQueuedPosInventoryLink(entry = {}, { outletId = null } = {}) {
  if (entry.inventory_item_id) {
    return {
      inventoryItemId: entry.inventory_item_id,
      depletionQty: Math.max(1, Number(entry.depletion_qty || 1))
    };
  }

  const menuItem = entry.menu_item_id ?
  readCache('pos-menu-items').find((item) => item?.id === entry.menu_item_id) :
  null;
  if (menuItem?.inventory_item_id) {
    return {
      inventoryItemId: menuItem.inventory_item_id,
      depletionQty: Math.max(1, Number(menuItem.depletion_qty || 1))
    };
  }

  const itemName = String(entry.item_name || '').trim().toLowerCase();
  if (!itemName) return { inventoryItemId: null, depletionQty: Math.max(1, Number(entry.depletion_qty || 1)) };
  const matches = readCache('inventory-items').filter((item) =>
  String(item?.name || '').trim().toLowerCase() === itemName && (
  !outletId || !item?.outlet_id || item.outlet_id === outletId)
  );
  return {
    inventoryItemId: matches.length === 1 ? matches[0].id : null,
    depletionQty: Math.max(1, Number(entry.depletion_qty || 1))
  };
}

function buildQueuedPosInventoryUsage(items = [], { outletId = null } = {}) {
  const usage = new Map();
  for (const entry of items || []) {
    const inventoryItemId = resolveQueuedPosInventoryLink(entry, { outletId }).inventoryItemId;
    const depletionQty = resolveQueuedPosInventoryLink(entry, { outletId }).depletionQty;
    if (!inventoryItemId) continue;
    const quantity = Math.max(0, Number(entry.quantity || 0));
    usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity * Math.max(1, Number(depletionQty || 1)));
  }
  return usage;
}

function buildPosOrderInventoryUsage(order) {
  const items = Array.isArray(order?.pos_order_items) ?
  order.pos_order_items :
  Array.isArray(order?.items) ?
  order.items :
  [];
  return buildQueuedPosInventoryUsage(items, { outletId: order?.outlet_id || null });
}

export function getOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  return [...buildQueuedPosInventoryUsage(items, { outletId }).entries()].
  map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }));
}

export function applyOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  const usage = buildQueuedPosInventoryUsage(items, { outletId });
  if (usage.size === 0) return [];
  const inventory = readCache('inventory-items');
  const next = inventory.map((item) => {
    const used = usage.get(item?.id) || 0;
    if (!used) return item;
    return {
      ...item,
      current_stock: Math.max(0, normalizeInventoryStockValue(item.current_stock) - used),
      _pending_sync: true,
      _sync_state: 'pending'
    };
  });
  writeCache('inventory-items', next, { source: 'local' });
  return getOfflinePosInventoryReservation(items, { outletId });
}

export function restoreOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  const usage = buildQueuedPosInventoryUsage(items, { outletId });
  if (usage.size === 0) return [];
  const inventory = readCache('inventory-items');
  const next = inventory.map((item) => {
    const restored = usage.get(item?.id) || 0;
    if (!restored) return item;
    return {
      ...item,
      current_stock: normalizeInventoryStockValue(item.current_stock) + restored,
      _pending_sync: true,
      _sync_state: 'pending'
    };
  });
  writeCache('inventory-items', next, { source: 'local' });
  return [...usage.entries()].map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }));
}

export function readLocalPosVoidHistory() {
  return readCache('pos-void-history');
}

function writeLocalPosVoidHistory(rows = []) {
  writeCache('pos-void-history', rows);
}

export function upsertLocalPosVoidHistory(entry = {}) {
  if (!entry?.id && !entry?.order_id) return null;
  const rows = readLocalPosVoidHistory();
  const normalized = {
    ...entry,
    id: entry.id || `local-void-${entry.order_id}-${Date.now()}`,
    action: entry.action || 'void',
    created_at: entry.created_at || new Date().toISOString()
  };
  const next = [
  normalized,
  ...rows.filter((row) => row?.id !== normalized.id && row?.order_id !== normalized.order_id)];

  writeLocalPosVoidHistory(next);
  return normalized;
}

function patchLocalPosVoidHistory(logId, patch = {}) {
  if (!logId) return false;
  const rows = readLocalPosVoidHistory();
  const index = rows.findIndex((row) => row?.id === logId);
  if (index < 0) return false;
  const next = [...rows];
  next[index] = { ...next[index], ...patch };
  writeLocalPosVoidHistory(next);
  return true;
}

export function applyQueuedPosInventoryReservations(remoteInventoryRows = []) {
  const queuedItems = readSyncQueue().filter((item) => isPosCreateOrderQueueItem(item) || isPosVoidQueueItem(item));
  if (queuedItems.length === 0) return remoteInventoryRows || [];

  const usage = new Map();
  for (const item of queuedItems) {
    const payload = item?.data?.payload || {};
    const orderUsage = buildQueuedPosInventoryUsage(payload.items || [], { outletId: payload.outlet_id || null });
    for (const [inventoryItemId, quantity] of orderUsage.entries()) {
      const multiplier = isPosVoidQueueItem(item) ? -1 : 1;
      usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity * multiplier);
    }
  }

  return (remoteInventoryRows || []).map((row) => {
    const used = usage.get(row?.id) || 0;
    if (!used) return row;
    return {
      ...row,
      current_stock: Math.max(0, normalizeInventoryStockValue(row.current_stock) - used),
      _pending_sync: true,
      _sync_state: 'pending'
    };
  });
}

async function getPosOrders(startDate, endDate, outletFilter = null) {
  return (await import('./' + 'pos.js')).getPosOrders(startDate, endDate, outletFilter)
}

async function getOutlets() {
  return (await import('./' + 'pos.js')).getOutlets()
}

// ─── INVENTORY ────────────────────────────────────────────────────────────────

async function getInventoryItems() {
  return (await import('./' + 'inventory.js')).getInventoryItems()
}

async function getInventoryPurchases(itemId) {
  return (await import('./' + 'inventory.js')).getInventoryPurchases(itemId)
}

async function getInventorySpend(startDate, endDate, outletId = 'all') {
  return (await import('./' + 'inventory.js')).getInventorySpend(startDate, endDate, outletId)
}

async function createInventoryItem(data) {
  return (await import('./' + 'inventory.js')).createInventoryItem(data)
}

async function deleteInventoryItem(id) {
  return (await import('./' + 'inventory.js')).deleteInventoryItem(id)
}

// ─── ROOM SUPPLIES ────────────────────────────────────────────────────────────

async function getSupplyItems() {
  return (await import('./' + 'supplies.js')).getSupplyItems()
}

async function getSupplyPurchases(itemId) {
  return (await import('./' + 'supplies.js')).getSupplyPurchases(itemId)
}

async function getSupplySpend(startDate, endDate) {
  return (await import('./' + 'supplies.js')).getSupplySpend(startDate, endDate)
}

async function getRoomSupplyAllocations(startDate, endDate) {
  return (await import('./' + 'supplies.js')).getRoomSupplyAllocations(startDate, endDate)
}

async function createSupplyItem(data) {
  return (await import('./' + 'supplies.js')).createSupplyItem(data)
}

async function deleteSupplyItem(id) {
  return (await import('./' + 'supplies.js')).deleteSupplyItem(id)
}


// ─── ANALYTICS & COST REPORTS ────────────────────────────────────────────────

async function getPosRevenueSummary(startDate, endDate, outletId = 'all') {
  return (await import('./' + 'pos.js')).getPosRevenueSummary(startDate, endDate, outletId)
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

async function getSettings() {
  return (await import('./' + 'settings.js')).getSettings();
}

async function getLodgeDiagnostics(expectedLodgeId = '') {
  return (await import('./' + 'settings.js')).getLodgeDiagnostics(expectedLodgeId);
}

export function isMissingEntitlementRpcError(error) {
  const message = String(error?.message || '');
  return error?.code === 'PGRST202' ||
  /get_lodge_entitlement|activate_license_key|issue_subscription_contract|update_subscription_contract|set_subscription_feature_override|clear_subscription_feature_override|schema cache/i.test(message);
}

async function getTrialStatus(lodgeId) {
  return (await import('./' + 'subscriptions.js')).getTrialStatus(lodgeId);
}

async function activateLicenseKey(lodgeId, licenseKey) {
  return (await import('./' + 'subscriptions.js')).activateLicenseKey(lodgeId, licenseKey);
}

// ─── MASTER ADMIN ──────────────────────────────────────────────────────────────

export async function checkMasterAdmin(email, password) {
  await checkOnline();
  if (!state.isOnline) {
    console.log('[MASTER] Connectivity ping reported offline — still attempting master_admins lookup (if service key is set)');
  }
  if (!state.adminDb) {
    return null;
  }
  const { data, error } = await requireAdmin().
  from('master_admins').
  select('*').
  eq('email', email.toLowerCase().trim()).
  limit(1);
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

export async function getAllCompanies() {
  if (!state.isOnline) return [];
  const { data } = await requireAdmin().
  from('settings').
  select('lodge_id, lodge_name, company_name, business_type, city, country, email, phone, updated_at, setup_complete, trial_started_at, deleted').
  eq('setup_complete', true).
  order('updated_at', { ascending: false });
  return data || [];
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
    actor_id: state.currentUser?.id || null,
    actor_role: state.currentUser?.role || null
  });
  return { success: true };
}

export async function restoreCompany(targetLodgeId) {
  if (!targetLodgeId) throw new Error('Company lodge_id is required');
  await updateCompany(targetLodgeId, { deleted: false, updated_at: new Date().toISOString() });
  await logAdminActivity(targetLodgeId, null, 'company_restored', {
    actor_id: state.currentUser?.id || null,
    actor_role: state.currentUser?.role || null
  });
  return { success: true };
}

const COMPANY_PURGE_TABLES = [
'pos_order_items',
'inventory_stocktake_lines',
'supply_stocktake_lines',
'room_supply_stocktake_lines',
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
  select('id, name, email, role, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by').
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
  await logAdminActivity(targetLodgeId, null, 'company_user_password_reset', {
    actor_id: state.currentUser?.id || null,
    actor_role: state.currentUser?.role || null,
    user_id: userId,
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
    actor_id: state.currentUser?.id || null,
    actor_role: state.currentUser?.role || null,
    user_id: userId,
    user_email: user.email || null,
    user_role: user.role || null,
    pwa_enabled: pwaAccess.enabled,
    pwa_disabled_reason: pwaAccess.disabled_reason,
    password_reset: Boolean(pwaAccess.password_hash)
  });
  return { success: true };
}

// ─── ADMIN: Licenses ───────────────────────────────────────────────────────────

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  const seg = (offset) => Array.from(bytes.slice(offset, offset + 4), (value) => chars[value % chars.length]).join('');
  return `BB-${seg(0)}-${seg(4)}-${seg(8)}`;
}

export async function getLicenses() {
  if (!state.isOnline) return [];
  const { data } = await requireAdmin().
  from('licenses').
  select('*').
  order('issued_at', { ascending: false });
  return (data || []).map((license) => ({
    ...license,
    subscription_plan: normalizePlanName(license.subscription_plan)
  }));
}

export async function createLicense({ lodge_id, lodge_name, business_type, expires_at, notes, subscription_plan, payment_status, monthly_fee, currency, next_due_date, last_payment_date }) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const normalizedPlan = normalizePlanName(subscription_plan);

  try {
    const { data, error } = await requireAdmin().rpc('issue_subscription_contract', {
      p_payload: {
        lodge_id: lodge_id || null,
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
        create_invoice: false
      }
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data.error || 'Could not create subscription');
    if (data?.license) return data.license;
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const license_key = generateLicenseKey();
    const { data, error } = await requireAdmin().from('licenses').insert({
      lodge_id: lodge_id || 'unassigned',
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
  const { error } = await requireAdmin().from('licenses').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteLicense(id) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('licenses').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

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

// ─── ADMIN: SUPPORT TICKETS ────────────────────────────────────────────────────

export async function getSupportTickets(filters = {}) {
  if (!state.isOnline) return [];
  let q = requireAdmin().from('support_tickets').select('*');
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.priority) q = q.eq('priority', filters.priority);
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id);
  const { data } = await q.order('created_at', { ascending: false });
  return data || [];
}

export async function createSupportTicket({ lodge_id, lodge_name, title, description, category, priority }) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  // Use the admin client when available (Command Central machine) to bypass RLS.
  // On lodge machines (no service key), fall back to the anon client — the anon
  // client can INSERT but cannot SELECT from support_tickets, so we skip .select()
  // to avoid a false RLS failure on the read-back that would mask a successful insert.
  const client = state.adminDb || state.supabase;
  const { error } = await client.
  from('support_tickets').
  insert({
    lodge_id: lodge_id || state.lodgeId,
    lodge_name: lodge_name || null,
    title,
    description,
    category: category || 'General',
    priority: priority || 'Normal',
    status: 'open'
  });
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function getLodgeSupportTickets(limit = 20) {
  if (!state.isOnline) return [];
  const { data, error } = await state.supabase.rpc('get_lodge_support_tickets', {
    p_lodge_id: state.lodgeId,
    p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100)
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function getLodgeSupportTicketById(id) {
  if (!id || !state.isOnline) return null;
  const tickets = await getLodgeSupportTickets(100);
  return tickets.find((ticket) => ticket.id === id) || null;
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
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not update request');
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
  return { success: true };
}

export async function deleteSupportTicket(id) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('support_tickets').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

// ─── ADMIN: ACTIVITY LOGS ──────────────────────────────────────────────────────

export async function logAdminActivity(targetLodgeId, targetLodgeName, action, details = {}) {
  if (!state.isOnline || !state.adminDb) return; // fire-and-forget, silent; skip if no admin client
  state.adminDb.from('activity_logs').insert({
    lodge_id: targetLodgeId,
    lodge_name: targetLodgeName || null,
    action,
    details
  }).then(() => {}).catch(() => {});
}

export async function getActivityLogs(filters = {}) {
  if (!state.isOnline) return [];
  let q = requireAdmin().from('activity_logs').select('*');
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id);
  if (filters.start) q = q.gte('created_at', filters.start);
  if (filters.end) q = q.lte('created_at', filters.end);
  const limit = filters.limit || 200;
  const { data } = await q.order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

// ─── ADMIN: COMPANY STATS ──────────────────────────────────────────────────────

export async function getCompanyStats(targetLodgeId) {
  if (!state.isOnline) return null;
  const db = requireAdmin();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const currentMonthWindow = getMonthWindowIso();
  const entitlement = await getTrialStatus(targetLodgeId).catch(() => null);
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
  select('*').
  lt('next_due_date', today).
  neq('payment_status', 'free').
  eq('is_active', true);
  return data || [];
}

// ─── INVOICES ────────────────────────────────────────────────────────────────────

export function isMissingInvoiceNumberRpcError(error) {
  const message = String(error?.message || '');
  return error?.code === 'PGRST202' ||
  /public\.get_next_invoice_number|get_next_invoice_number.*schema cache|schema cache.*get_next_invoice_number/i.test(message);
}

function formatInvoiceNumber(year, sequence) {
  return `INV-${year}-${String(sequence).padStart(4, '0')}`;
}

function parseInvoiceSequence(invoiceNumber, prefix) {
  if (typeof invoiceNumber !== 'string' || !invoiceNumber.startsWith(prefix)) return null;
  const sequence = Number.parseInt(invoiceNumber.slice(prefix.length), 10);
  return Number.isInteger(sequence) ? sequence : null;
}

export async function getNextInvoiceNumberByLookup(db) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  const [bookingResult, invoiceResult] = await Promise.all([
  db.
  from('bookings').
  select('invoice_number').
  eq('lodge_id', state.lodgeId).
  like('invoice_number', `${prefix}%`),
  db.
  from('invoices').
  select('invoice_number').
  eq('lodge_id', state.lodgeId).
  like('invoice_number', `${prefix}%`)]
  );

  const rows = [];
  const errors = [];
  let successfulLookups = 0;

  if (bookingResult.error) errors.push(bookingResult.error);else
  {
    successfulLookups += 1;
    rows.push(...(bookingResult.data || []));
  }

  if (invoiceResult.error) errors.push(invoiceResult.error);else
  {
    successfulLookups += 1;
    rows.push(...(invoiceResult.data || []));
  }

  if (successfulLookups === 0 && errors.length > 0) {
    throw new Error('Failed to generate invoice number: ' + errors[0].message);
  }

  const sequences = rows.
  map((row) => parseInvoiceSequence(row?.invoice_number, prefix)).
  filter((value) => Number.isInteger(value));

  const next = sequences.length > 0 ? Math.max(...sequences) + 1 : 1;
  return formatInvoiceNumber(year, next);
}

export async function getNextInvoiceNumber() {
  // Use the same atomic DB sequence function as booking invoices to prevent
  // collisions under concurrent Command Central usage.
  const db = requireAdmin();
  const { data, error } = await db.rpc('get_next_invoice_number', { p_lodge_id: state.lodgeId });
  if (error) {
    if (!isMissingInvoiceNumberRpcError(error)) {
      throw new Error('Failed to generate invoice number: ' + error.message);
    }
    console.warn('[Invoices] get_next_invoice_number RPC unavailable for admin flow, falling back to lookup:', error.message);
    return await getNextInvoiceNumberByLookup(db);
  }
  return data;
}

export async function createInvoice(data) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data: row, error } = await requireAdmin().from('invoices').insert(data).select().single();
  if (error) throw new Error(error.message);
  return row;
}

export async function getInvoices(filters = {}) {
  if (!state.isOnline) return [];
  let q = requireAdmin().from('invoices').select('*').order('created_at', { ascending: false });
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id);
  if (filters.status) q = q.eq('status', filters.status);
  const { data } = await q;
  return data || [];
}

export async function getInvoicesByLodge(lodgeId) {
  if (!state.isOnline) return [];
  const { data } = await state.supabase.
  from('invoices').
  select('*').
  eq('lodge_id', lodgeId).
  order('issued_at', { ascending: false });
  return data || [];
}

export async function getFinancialAuditLog({ bookingId = null, limit = 100, offset = 0 } = {}) {
  if (!state.lodgeId || !state.isOnline) return [];
  const { data, error } = await state.supabase.rpc('get_financial_audit_log', {
    p_lodge_id: state.lodgeId,
    p_booking_id: bookingId || null,
    p_limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    p_offset: Math.max(Number(offset) || 0, 0)
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export function roundMoneyValue(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function moneyMismatch(left, right, tolerance = 0.01) {
  return Math.abs(roundMoneyValue(left) - roundMoneyValue(right)) > tolerance;
}

export async function getFinancialReconciliation() {
  if (!state.lodgeId) {
    return {
      summary: { paymentMismatches: 0, chargeMismatches: 0, invoiceGaps: 0, orphanInvoices: 0, folioPosMismatches: 0 },
      paymentMismatches: [],
      chargeMismatches: [],
      invoiceGaps: [],
      orphanInvoices: [],
      folioPosMismatches: []
    };
  }

  let bookings = [];
  let payments = [];
  let charges = [];
  let invoices = [];
  let posOrders = [];

  if (state.isOnline) {
    const [
    bookingsResult,
    paymentsResult,
    chargesResult,
    invoicesResult,
    posOrdersResult] =
    await Promise.all([
    state.supabase.from('bookings').select('id, invoice_number, total_amount, charges_total, amount_paid, status, payment_status, check_in, check_out, updated_at').eq('lodge_id', state.lodgeId),
    state.supabase.from('payments').select('booking_id, amount, type, paid_at').eq('lodge_id', state.lodgeId),
    state.supabase.from('booking_charges').select('id, booking_id, amount, description, voided_at, void_reason, created_at').eq('lodge_id', state.lodgeId),
    state.supabase.from('invoices').select('id, booking_id, invoice_number, issued_at, created_at').eq('lodge_id', state.lodgeId),
    state.supabase.from('pos_orders').select('id, booking_id, total, payment_method, status, folio_charge_id, created_at').eq('lodge_id', state.lodgeId)]
    );

    if (bookingsResult.error) throw new Error(bookingsResult.error.message);
    if (paymentsResult.error) throw new Error(paymentsResult.error.message);
    if (chargesResult.error) throw new Error(chargesResult.error.message);
    if (invoicesResult.error) throw new Error(invoicesResult.error.message);
    if (posOrdersResult.error) throw new Error(posOrdersResult.error.message);

    bookings = bookingsResult.data || [];
    payments = paymentsResult.data || [];
    charges = chargesResult.data || [];
    invoices = invoicesResult.data || [];
    posOrders = posOrdersResult.data || [];
  } else {
    // P0-3: offline reconciliation is INVALID — payment/charge/invoice tables cannot
    // be queried. Return an explicitly invalid result so the UI cannot show "clear".
    return {
      local_only: true,
      valid: false,
      checked_at: new Date().toISOString(),
      summary: { paymentMismatches: 0, chargeMismatches: 0, invoiceGaps: 0, orphanInvoices: 0, folioPosMismatches: 0 },
      paymentMismatches: [],
      chargeMismatches: [],
      invoiceGaps: [],
      orphanInvoices: [],
      folioPosMismatches: [],
      message: 'Reconciliation cannot be verified while offline. Connect to the internet and run again.'
    };
  }

  const paymentsByBooking = new Map();
  for (const payment of payments) {
    const bookingId = payment?.booking_id;
    if (!bookingId) continue;
    paymentsByBooking.set(bookingId, roundMoneyValue((paymentsByBooking.get(bookingId) || 0) + Number(payment.amount || 0)));
  }

  const activeChargesByBooking = new Map();
  for (const charge of charges) {
    if (charge?.voided_at) continue;
    const bookingId = charge?.booking_id;
    if (!bookingId) continue;
    activeChargesByBooking.set(bookingId, roundMoneyValue((activeChargesByBooking.get(bookingId) || 0) + Number(charge.amount || 0)));
  }

  const invoiceByBooking = new Map();
  for (const invoice of invoices) {
    if (!invoice?.booking_id) continue;
    if (!invoiceByBooking.has(invoice.booking_id)) {
      invoiceByBooking.set(invoice.booking_id, invoice);
    }
  }

  const bookingIds = new Set(bookings.map((booking) => booking.id));
  const paymentMismatches = bookings.
  filter((booking) => !['cancelled'].includes(String(booking.status || '').toLowerCase())).
  map((booking) => {
    const paymentLedgerTotal = roundMoneyValue(paymentsByBooking.get(booking.id) || 0);
    const cachedAmountPaid = roundMoneyValue(booking.amount_paid || 0);
    return {
      booking_id: booking.id,
      invoice_number: booking.invoice_number || null,
      status: booking.status || '',
      booking_amount_paid: cachedAmountPaid,
      payment_ledger_total: paymentLedgerTotal,
      difference: roundMoneyValue(cachedAmountPaid - paymentLedgerTotal),
      updated_at: booking.updated_at || null
    };
  }).
  filter((row) => moneyMismatch(row.booking_amount_paid, row.payment_ledger_total)).
  sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference));

  const chargeMismatches = bookings.
  filter((booking) => !['cancelled'].includes(String(booking.status || '').toLowerCase())).
  map((booking) => {
    const chargeLedgerTotal = roundMoneyValue(activeChargesByBooking.get(booking.id) || 0);
    const cachedChargesTotal = roundMoneyValue(booking.charges_total || 0);
    return {
      booking_id: booking.id,
      invoice_number: booking.invoice_number || null,
      status: booking.status || '',
      booking_charges_total: cachedChargesTotal,
      charge_ledger_total: chargeLedgerTotal,
      difference: roundMoneyValue(cachedChargesTotal - chargeLedgerTotal),
      updated_at: booking.updated_at || null
    };
  }).
  filter((row) => moneyMismatch(row.booking_charges_total, row.charge_ledger_total)).
  sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference));

  const invoiceGaps = bookings.
  filter((booking) => String(booking.status || '').toLowerCase() !== 'cancelled').
  filter((booking) => !String(booking.invoice_number || '').trim() || !invoiceByBooking.has(booking.id)).
  map((booking) => ({
    booking_id: booking.id,
    invoice_number: booking.invoice_number || null,
    status: booking.status || '',
    check_in: booking.check_in || null,
    check_out: booking.check_out || null,
    missing_invoice_number: !String(booking.invoice_number || '').trim(),
    missing_invoice_row: !invoiceByBooking.has(booking.id)
  }));

  const orphanInvoices = invoices.
  filter((invoice) => !invoice?.booking_id || !bookingIds.has(invoice.booking_id)).
  map((invoice) => ({
    invoice_id: invoice.id,
    booking_id: invoice.booking_id || null,
    invoice_number: invoice.invoice_number || null,
    issued_at: invoice.issued_at || invoice.created_at || null
  }));

  const folioPosMismatches = (posOrders || []).
  filter((order) => String(order?.payment_method || '').toLowerCase() === 'folio').
  filter((order) => String(order?.status || '').toLowerCase() !== 'voided').
  map((order) => {
    const bookingId = order?.booking_id || null;
    const bookingExists = bookingId ? bookingIds.has(bookingId) : false;
    const matchingCharge = order?.folio_charge_id ?
    charges.find((charge) => charge.id === order.folio_charge_id && !charge.voided_at) :
    null;
    return {
      order_id: order.id,
      booking_id: bookingId,
      order_total: roundMoneyValue(order.total || 0),
      folio_charge_id: order.folio_charge_id || null,
      folio_charge_total: roundMoneyValue(matchingCharge?.amount || 0),
      issue: !bookingId ?
      'missing_booking' :
      !bookingExists ?
      'orphan_booking' :
      !order.folio_charge_id ?
      'missing_folio_charge' :
      !matchingCharge ?
      'missing_charge_row' :
      moneyMismatch(order.total || 0, matchingCharge.amount || 0) ?
      'amount_mismatch' :
      null,
      created_at: order.created_at || null
    };
  }).
  filter((row) => row.issue);

  return {
    valid: true,
    local_only: false,
    checked_at: new Date().toISOString(),
    summary: {
      paymentMismatches: paymentMismatches.length,
      chargeMismatches: chargeMismatches.length,
      invoiceGaps: invoiceGaps.length,
      orphanInvoices: orphanInvoices.length,
      folioPosMismatches: folioPosMismatches.length
    },
    paymentMismatches: paymentMismatches.slice(0, 50),
    chargeMismatches: chargeMismatches.slice(0, 50),
    invoiceGaps: invoiceGaps.slice(0, 50),
    orphanInvoices: orphanInvoices.slice(0, 50),
    folioPosMismatches: folioPosMismatches.slice(0, 50)
  };
}

export async function getFinancialValidationSummary() {
  const reconciliation = await getFinancialReconciliation();
  const auditRows = state.isOnline ? await getFinancialAuditLog({ limit: 200 }) : [];

  const recentRefunds = auditRows.
  filter((row) => row.action === 'refund_recorded').
  slice(0, 10).
  map((row) => ({
    booking_id: row.booking_id,
    amount_delta: roundMoneyValue(row.amount_delta || 0),
    created_at: row.created_at,
    actor_id: row.actor_id || null,
    retained_percent: row.after_snapshot?.refund_retained_percent ?? null
  }));

  const recentChargeVoids = auditRows.
  filter((row) => row.action === 'charge_deleted').
  slice(0, 10).
  map((row) => ({
    booking_id: row.booking_id,
    created_at: row.created_at,
    actor_id: row.actor_id || null,
    amount_delta: roundMoneyValue(row.amount_delta || 0),
    reason: row.after_snapshot?.void_reason || null
  }));

  return {
    checked_at: new Date().toISOString(),
    totals: {
      audit_rows_sampled: auditRows.length,
      recent_refunds: recentRefunds.length,
      recent_charge_voids: recentChargeVoids.length,
      payment_mismatches: reconciliation.summary.paymentMismatches,
      charge_mismatches: reconciliation.summary.chargeMismatches,
      folio_pos_mismatches: reconciliation.summary.folioPosMismatches,
      invoice_gaps: reconciliation.summary.invoiceGaps,
      orphan_invoices: reconciliation.summary.orphanInvoices
    },
    recentRefunds,
    recentChargeVoids,
    reconciliation
  };
}

export async function recordInvoiceDelivery(payload = {}) {
  const row = {
    id: payload.id || randomUUID(),
    lodge_id: state.lodgeId || payload.lodge_id || null,
    booking_id: payload.booking_id || null,
    invoice_number: payload.invoice_number || null,
    delivery_type: payload.delivery_type || 'invoice_email',
    delivery_status: payload.delivery_status || 'completed',
    recipient: payload.recipient || null,
    file_path: payload.file_path || null,
    render_version: payload.render_version || null,
    initiated_by: state.currentUser?.id || payload.initiated_by || null,
    initiated_by_name: state.currentUser?.name || payload.initiated_by_name || null,
    metadata: payload.metadata || {},
    created_at: new Date().toISOString(),
    local_only: !state.isOnline
  };

  if (!state.isOnline || !state.lodgeId) {
    appendAuxiliaryLog(LOCAL_INVOICE_DELIVERY_FILE, row, 300);
    return { success: true, localOnly: true, row };
  }

  const { data, error } = await state.supabase.rpc('record_invoice_delivery', {
    p_lodge_id: state.lodgeId,
    p_booking_id: payload.booking_id || null,
    p_invoice_number: payload.invoice_number || null,
    p_delivery_type: payload.delivery_type || 'invoice_email',
    p_delivery_status: payload.delivery_status || 'completed',
    p_recipient: payload.recipient || null,
    p_file_path: payload.file_path || null,
    p_render_version: payload.render_version || null,
    p_initiated_by: state.currentUser?.id || null,
    p_metadata: payload.metadata || {}
  });

  if (error) throw new Error(error.message);
  return { success: data?.success !== false, id: data?.id || null, row: { ...row, local_only: false } };
}

export async function getInvoiceDeliveryHistory({ bookingId = null, limit = 100 } = {}) {
  const localRows = readAuxiliaryLog(LOCAL_INVOICE_DELIVERY_FILE).
  filter((row) => !bookingId || row.booking_id === bookingId).
  slice(0, limit);

  if (!state.isOnline || !state.lodgeId) return localRows;

  const { data, error } = await state.supabase.rpc('get_invoice_delivery_history', {
    p_lodge_id: state.lodgeId,
    p_booking_id: bookingId || null,
    p_limit: limit
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.map((row) => ({ ...row, local_only: false })) : [];
}

export async function runFinancialValidation({ triggerSource = 'manual' } = {}) {
  const validation = await getFinancialValidationSummary();
  const run = {
    id: randomUUID(),
    lodge_id: state.lodgeId,
    triggered_by: state.currentUser?.id || null,
    triggered_by_name: state.currentUser?.name || null,
    trigger_source: ['manual', 'scheduled', 'startup'].includes(triggerSource) ? triggerSource : 'manual',
    date_key: getLocalDateKey(new Date(), LOCAL_TIME_ZONE),
    summary: {
      checked_at: validation.checked_at,
      totals: validation.totals,
      sample: {
        recent_refunds: validation.recentRefunds || [],
        recent_charge_voids: validation.recentChargeVoids || []
      }
    },
    created_at: new Date().toISOString(),
    local_only: !state.isOnline
  };

  appendAuxiliaryLog(FINANCIAL_VALIDATION_RUNS_FILE, run, 120);

  const issueCount =
  Number(validation?.totals?.payment_mismatches || 0) +
  Number(validation?.totals?.charge_mismatches || 0) +
  Number(validation?.totals?.folio_pos_mismatches || 0) +
  Number(validation?.totals?.invoice_gaps || 0) +
  Number(validation?.totals?.orphan_invoices || 0);

  if (issueCount > 0) {
    appendAuxiliaryLog(FINANCIAL_VALIDATION_ALERTS_FILE, {
      id: randomUUID(),
      at: new Date().toISOString(),
      lodge_id: state.lodgeId || null,
      trigger_source: run.trigger_source,
      issue_count: issueCount,
      totals: validation.totals
    }, 120);
  }

  if (state.isOnline && state.lodgeId) {
    try {
      await state.supabase.rpc('record_financial_validation_run', {
        p_lodge_id: state.lodgeId,
        p_trigger_source: run.trigger_source,
        p_triggered_by: state.currentUser?.id || null,
        p_summary: run.summary
      });
      run.local_only = false;
    } catch (error) {
      console.warn('record_financial_validation_run failed:', error?.message || error);
    }
  }

  logActivity(
    'financial_validation_run',
    `Financial validation run · ${run.trigger_source} · ${validation.totals.payment_mismatches || 0} payment mismatches · ${validation.totals.charge_mismatches || 0} charge mismatches · ${validation.totals.folio_pos_mismatches || 0} folio POS mismatches · ${validation.totals.invoice_gaps || 0} invoice gaps`
  );

  return { success: true, run, validation };
}

export async function getFinancialValidationAlerts(limit = 30) {
  const localAlerts = readAuxiliaryLog(FINANCIAL_VALIDATION_ALERTS_FILE).slice(0, limit);
  if (!state.isOnline || !state.lodgeId) return localAlerts;

  try {
    const { data, error } = await state.supabase.rpc('get_financial_validation_alerts', {
      p_lodge_id: state.lodgeId,
      p_limit: limit
    });
    if (error) throw error;
    return Array.isArray(data) ? data.map((row) => ({ ...row, local_only: false })) : localAlerts;
  } catch (error) {
    recordCriticalError('financial.validation.alerts', error, { limit }, { level: 'warn', limit: 120 });
    return localAlerts;
  }
}

function getCriticalErrorLogForSupport(limit = 100) {
  return readAuxiliaryLog(CRITICAL_ERROR_LOG_FILE).
  filter((entry) => !isNonCriticalOperationalError(entry?.scope, entry?.message)).
  slice(0, limit);
}

export async function getSupportBundle(limit = 20) {
  const systemHealth = await getSystemHealth().catch((error) => ({ error: error?.message || String(error) }));
  const syncStatus = getSyncStatus();
  const syncDetails = getSyncDetails();
  const reconciliation = await getFinancialReconciliation().catch((error) => ({ error: error?.message || String(error) }));
  const validation = await getFinancialValidationSummary().catch((error) => ({ error: error?.message || String(error) }));
  const validationRuns = await getFinancialValidationRuns(limit).catch(() => []);
  const validationAlerts = await getFinancialValidationAlerts(limit).catch(() => []);
  const criticalErrors = getCriticalErrorLogForSupport(limit);
  const syncMeta = readSyncMeta();
  const healthFaults = readHealthFaults().slice(0, Math.max(1, Number(limit) || 20));

  return {
    generated_at: new Date().toISOString(),
    lodge_id: state.lodgeId || null,
    user_id: state.currentUser?.id || null,
    user_name: state.currentUser?.name || null,
    app_online: state.isOnline,
    system_health: systemHealth,
    sync_status: syncStatus,
    sync_details: syncDetails,
    syncMeta,
    healthFaults,
    financial_reconciliation: reconciliation,
    financial_validation: validation,
    financial_validation_runs: validationRuns,
    financial_validation_alerts: validationAlerts,
    critical_errors: criticalErrors
  };
}

export async function getOfflineSafetyData() {
  const today = getLocalDateKey(new Date(), LOCAL_TIME_ZONE);
  const tomorrow = getLocalDateKey(addDays(new Date(), 1), LOCAL_TIME_ZONE);
  const bookings = await getAllBookings().catch(() => readCache('bookings'));
  const rooms = await getAllRooms().catch(() => readCache('rooms'));
  const customers = await getAllCustomers().catch(() => readCache('customers'));
  const inventoryItems = await getInventoryItems().catch(() => readCache('inventory-items'));

  const roomById = new Map((rooms || []).map((room) => [room.id, room]));
  const customerById = new Map((customers || []).map((customer) => [customer.id, customer]));
  const activeBookings = (bookings || []).filter((booking) => String(booking?.status || '').toLowerCase() !== 'cancelled');
  const enrichBooking = (booking) => {
    const room = roomById.get(booking.room_id) || {};
    const customer = customerById.get(booking.customer_id) || {};
    const total = Number(booking.total_amount || 0) + Number(booking.charges_total || 0);
    const paid = Number(booking.amount_paid || 0);
    return {
      booking_id: booking.id,
      booking_number: booking.booking_number || booking.invoice_number || '',
      guest_name: booking.customer_name || customer.name || '',
      room_number: booking.room_number || room.room_number || '',
      check_in: booking.check_in || '',
      check_out: booking.check_out || '',
      status: booking.status || '',
      payment_status: booking.payment_status || '',
      balance: Math.max(0, total - paid)
    };
  };

  return {
    generated_at: new Date().toISOString(),
    lodge_id: state.lodgeId || null,
    source: state.isOnline ? 'online' : 'offline-cache',
    arrivals: activeBookings.filter((booking) => booking.check_in === today).map(enrichBooking),
    departures: activeBookings.filter((booking) => booking.check_out === today).map(enrichBooking),
    in_house: activeBookings.filter((booking) => booking.check_in <= today && booking.check_out > today).map(enrichBooking),
    due_tomorrow: activeBookings.filter((booking) => booking.check_in === tomorrow || booking.check_out === tomorrow).map(enrichBooking),
    unpaid: activeBookings.
    filter((booking) => ['partial', 'unpaid', ''].includes(String(booking.payment_status || '').toLowerCase())).
    map(enrichBooking).
    filter((booking) => booking.balance > 0),
    low_stock: (inventoryItems || []).
    filter((item) => Number(item.reorder_level || 0) > 0 && Number(item.current_stock || 0) <= Number(item.reorder_level || 0)).
    map((item) => ({
      item_id: item.id,
      name: item.name || item.item_name || '',
      category: item.category || '',
      current_stock: Number(item.current_stock || 0),
      reorder_level: Number(item.reorder_level || 0),
      unit: item.unit || ''
    }))
  };
}

function getDesktopDeviceId() {
  try {
    const source = app?.getPath?.('userData') || state.cacheRootDir || 'boroko-desktop';
    return crypto.createHash('sha256').update(String(source)).digest('hex').slice(0, 24);
  } catch {
    return 'desktop-unknown';
  }
}

export async function publishDeviceHealth() {
  if (!state.isOnline || !state.lodgeId) return { success: false, skipped: true, error: 'Offline or lodge not selected.' };
  const details = getSyncDetails();
  const faults = readHealthFaults();
  const reconciliation = await getFinancialReconciliation().catch(() => ({ state: 'unknown' }));
  const topFaultTypes = [...new Set(faults.map((fault) => fault?.type).filter(Boolean))].slice(0, 10);
  const { data, error } = await state.supabase.rpc('upsert_device_health', {
    p_lodge_id: state.lodgeId,
    p_device_id: getDesktopDeviceId(),
    p_client_type: 'desktop',
    p_pending_queue_count: details.pendingCount || 0,
    p_failed_queue_count: details.failedCount || 0,
    p_unresolved_local_count: details.unresolvedLocal?.length || 0,
    p_replay_auth_ready: !!state.replayAuthReady,
    p_last_successful_sync_at: details.lastSuccessfulSyncAt || null,
    p_reconciliation_state: reconciliation?.state || 'unknown',
    p_top_fault_types: topFaultTypes,
    p_raw_summary: {
      pendingCount: details.pendingCount || 0,
      failedCount: details.failedCount || 0,
      unresolvedLocalCount: details.unresolvedLocal?.length || 0,
      driftFaultTypes: SYNC_DRIFT_FAULT_TYPES
    }
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not publish device health');
  return { success: true };
}

export async function getDeviceHealthRollup() {
  if (!state.isOnline || !state.lodgeId) return { available: false, devices: [] };
  await publishDeviceHealth().catch(() => {});
  const { data, error } = await state.supabase.rpc('get_device_health_rollup', { p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  return { available: true, devices: Array.isArray(data) ? data : [] };
}

export async function getFinancialValidationRuns(limit = 30) {
  const localRuns = readAuxiliaryLog(FINANCIAL_VALIDATION_RUNS_FILE).slice(0, limit);
  if (!state.isOnline || !state.lodgeId) return localRuns;

  const { data, error } = await state.supabase.rpc('get_financial_validation_runs', {
    p_lodge_id: state.lodgeId,
    p_limit: limit
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.map((row) => ({ ...row, local_only: false })) : [];
}

export async function runScheduledFinancialValidation(triggerSource = 'scheduled') {
  if (!state.currentUser || !state.lodgeId) return { success: false, skipped: true, reason: 'Not signed in' };
  const todayKey = getLocalDateKey(new Date(), LOCAL_TIME_ZONE);
  const existingRuns = readAuxiliaryLog(FINANCIAL_VALIDATION_RUNS_FILE);
  const alreadyRanToday = existingRuns.some((row) => row?.lodge_id === state.lodgeId && row?.date_key === todayKey);
  if (alreadyRanToday) return { success: true, skipped: true, reason: 'Already ran today' };
  return runFinancialValidation({ triggerSource });
}

export async function updateInvoice(id, updates) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('invoices').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteInvoice(id) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('invoices').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getInvoiceSummary() {
  if (!state.isOnline) return { total: 0, byPlan: {}, byMonth: [], allRows: [] };
  const { data } = await requireAdmin().
  from('invoices').
  select('amount, currency, package_name, issued_date, status');
  const allRows = data || [];
  const paid = allRows.filter((r) => r.status === 'paid');
  const total = paid.reduce((s, r) => s + Number(r.amount), 0);
  const byPlan = {};
  paid.forEach((r) => {
    const planName = normalizePlanName(r.package_name);
    byPlan[planName] = (byPlan[planName] || 0) + Number(r.amount);
  });
  const byMonthMap = {};
  paid.forEach((r) => {
    const m = (r.issued_date || '').slice(0, 7);
    if (m) byMonthMap[m] = (byMonthMap[m] || 0) + Number(r.amount);
  });
  const byMonth = Object.entries(byMonthMap).
  sort(([a], [b]) => a.localeCompare(b)).
  map(([month, amount]) => ({ month, amount }));
  const currency = paid[0]?.currency || 'USD';
  return { total, byPlan, byMonth, currency, allRows };
}

// ─── CONFERENCE BOOKINGS ───────────────────────────────────────────────────────

async function getConferenceBookings(start, end) {
  return (await import('./' + 'conference.js')).getConferenceBookings(start, end)
}

// ─── POOL / DAY USE ────────────────────────────────────────────────────────────

async function getPoolDayUse(start, end) {
  return (await import('./' + 'pool.js')).getPoolDayUse(start, end)
}

// ─────────────────────────────────────────────────────────────────────────────
// QUOTATIONS
// ─────────────────────────────────────────────────────────────────────────────

// Tax helper — rate is a percentage (e.g. 14 = 14%). Default 0.
// Lightweight: only transitions draft → sent. Safe to call multiple times.
// ── Data Import ───────────────────────────────────────────────────────────────

export const IMPORT_TEMPLATES = {
  bookings: [
  { key: 'guest_name', label: 'Guest Name', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'id_number', label: 'ID / Passport No', required: false },
  { key: 'nationality', label: 'Nationality', required: false },
  { key: 'room_number', label: 'Room Number', required: true },
  { key: 'check_in', label: 'Check-In Date', required: true },
  { key: 'check_out', label: 'Check-Out Date', required: true },
  { key: 'adults', label: 'Adults', required: false },
  { key: 'children', label: 'Children', required: false },
  { key: 'total_amount', label: 'Total Amount', required: false },
  { key: 'amount_paid', label: 'Amount Paid', required: false },
  { key: 'payment_method', label: 'Payment Method', required: false },
  { key: 'status', label: 'Booking Status', required: false },
  { key: 'notes', label: 'Notes', required: false }],

  guests: [
  { key: 'name', label: 'Guest Name', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'id_number', label: 'ID / Passport No', required: false },
  { key: 'nationality', label: 'Nationality', required: false }],

  rooms: [
  { key: 'room_number', label: 'Room Number', required: true },
  { key: 'room_type', label: 'Room Type', required: false },
  { key: 'rate', label: 'Rate', required: false },
  { key: 'max_adults', label: 'Max Adults', required: false },
  { key: 'max_children', label: 'Max Children', required: false }],

  inventory: [
  { key: 'name', label: 'Item Name', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'current_stock', label: 'Current Stock', required: false },
  { key: 'reorder_level', label: 'Reorder Level', required: false }],

  supplies: [
  { key: 'name', label: 'Supply Item', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'current_stock', label: 'Current Stock', required: false },
  { key: 'reorder_level', label: 'Reorder Level', required: false }],

  expenses: [
  { key: 'date', label: 'Date', required: true },
  { key: 'category', label: 'Category', required: true },
  { key: 'description', label: 'Description', required: false },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'paid_by', label: 'Paid By', required: false }]

};

export function normalizeImportType(type = 'bookings') {
  return Object.prototype.hasOwnProperty.call(IMPORT_TEMPLATES, type) ? type : 'bookings';
}

export function importRowValue(row = {}, ...keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

export function importNumber(row = {}, keys = [], fallback = 0) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    }
  }
  return fallback;
}

export function findImportDuplicate(type, row = {}) {
  if (type === 'guests') {
    const name = importRowValue(row, 'name', 'guest_name').toLowerCase();
    const email = importRowValue(row, 'email').toLowerCase();
    const phone = importRowValue(row, 'phone');
    return readCache('customers').find((customer) =>
    email && String(customer.email || '').toLowerCase() === email ||
    phone && name && String(customer.phone || '') === phone && String(customer.name || customer.full_name || '').toLowerCase() === name ||
    !email && !phone && name && String(customer.name || customer.full_name || '').toLowerCase() === name
    );
  }
  if (type === 'rooms') {
    const roomNumber = importRowValue(row, 'room_number');
    return readCache('rooms').find((room) => String(room.room_number || '').trim() === roomNumber);
  }
  if (type === 'inventory') {
    const name = importRowValue(row, 'name', 'item_name').toLowerCase();
    const category = importRowValue(row, 'category').toLowerCase();
    return readCache('inventory-items').find((item) =>
    String(item.name || item.item_name || '').toLowerCase() === name &&
    String(item.category || '').toLowerCase() === category
    );
  }
  if (type === 'supplies') {
    const name = importRowValue(row, 'name', 'item_name').toLowerCase();
    const category = importRowValue(row, 'category').toLowerCase();
    return readCache('supply-items').find((item) =>
    String(item.name || item.item_name || '').toLowerCase() === name &&
    String(item.category || '').toLowerCase() === category
    );
  }
  if (type === 'expenses') {
    const date = importRowValue(row, 'date');
    const category = importRowValue(row, 'category').toLowerCase();
    const description = importRowValue(row, 'description').toLowerCase();
    const amount = importNumber(row, ['amount'], 0);
    return readCache('expenses').find((expense) =>
    String(expense.date || '') === date &&
    String(expense.category || '').toLowerCase() === category &&
    String(expense.description || '').toLowerCase() === description &&
    Number(expense.amount || 0) === amount
    );
  }
  return null;
}

export function validateImportRow(type, row = {}) {
  const errors = [];
  if (type === 'guests') {
    if (!importRowValue(row, 'name', 'guest_name')) errors.push('Guest name is required.');
  } else if (type === 'rooms') {
    if (!importRowValue(row, 'room_number')) errors.push('Room number is required.');
    if (importNumber(row, ['rate_per_night', 'rate'], 0) < 0) errors.push('Room rate cannot be negative.');
  } else if (type === 'inventory' || type === 'supplies') {
    if (!importRowValue(row, 'name', 'item_name')) errors.push('Item name is required.');
    if (importNumber(row, ['current_stock'], 0) < 0) errors.push('Current stock cannot be negative.');
    if (importNumber(row, ['reorder_level'], 0) < 0) errors.push('Reorder level cannot be negative.');
  } else if (type === 'expenses') {
    if (!importRowValue(row, 'date')) errors.push('Date is required.');
    if (!importRowValue(row, 'category')) errors.push('Category is required.');
    if (importNumber(row, ['amount'], 0) <= 0) errors.push('Amount must be greater than zero.');
  }
  return errors;
}

export function friendlyImportError(msg = '') {
  const m = String(msg).toLowerCase();
  if (m.includes('room is already booked') || m.includes('no_overlapping_bookings'))
  return 'This room is already booked for those dates.';
  if (m.includes('room not found') || m.includes('room "'))
  return 'Room number not found — check it matches an existing room exactly.';
  if (m.includes('guest name') || m.includes('name is required'))
  return 'Guest name is missing.';
  if (m.includes('check-in') || m.includes('check-out') || m.includes('invalid dates'))
  return 'Check-in or check-out date is invalid. Use YYYY-MM-DD format.';
  if (m.includes('payment') || m.includes('amount must be greater'))
  return 'Payment amount is invalid.';
  if (m.includes('customer') || m.includes('create_customer'))
  return 'Could not save the guest record.';
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch'))
  return 'Network error — check your internet connection and try again.';
  if (m.includes('permission') || m.includes('policy') || m.includes('rls'))
  return 'Permission denied — contact your administrator.';
  if (m.includes('duplicate') || m.includes('unique') || m.includes('23505'))
  return 'A duplicate record already exists for this entry.';
  if (m.includes('invalid total') || m.includes('room rate'))
  return 'Could not calculate the total — check room rate and dates.';
  if (m.includes('supabase') || m.includes('.catch') || m.includes('is not a function'))
  return 'An unexpected system error occurred. Please try again.';
  return msg || 'An unexpected error occurred.';
}
