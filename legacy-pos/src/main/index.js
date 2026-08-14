import dotenv from 'dotenv';
import { app, BrowserWindow, ipcMain, session, safeStorage } from 'electron';
import autoUpdaterPkg from 'electron-updater';
import fetch, { Headers, Request, Response } from 'cross-fetch';
import WebSocket from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { normalizePosHardwareSettings } from '../shared/hardwareSettings.js';
import {
  buildCreatePosOrderPayloadV3,
  adaptLegacyPosOrderFinancialPayload,
  buildVoidPayload,
  buildReturnPayloadV3,
  buildFinalizeCashupPayloadV2,
  normalizePaymentBreakdown,
  validateProviderPaymentReferences
} from '../shared/payloads.js';
import {
  createQueueItem,
  isQueueItemReady,
  markItemSyncing,
  markItemSynced,
  markItemFailed,
  isNetworkError
} from '../shared/offlineQueue.js';
import { sanitizePosError } from '../shared/errors.js';
import {
  printEscPosReceipt,
  openCashDrawer as openCashDrawerHardware,
  testPosHardwareDevice,
  sendPaymentTerminalTotal
} from './hardware/posHardwareAdapter.js';
import { LOW_RESOURCE, getLowResourceConfig } from '../shared/lowResource.js';
import { buildPosTotals, normalizeMoney } from '../shared/totals.js';
import {
  appendFinancialJournalEvent,
  rebuildFinancialQueueFromJournal
} from './storage/financialJournal.js';
import {
  protectLegacyQueuePayload,
  resolveLegacyQueuePayload
} from './storage/secureQueueSecrets.js';
import { createLegacyMeshController } from './mesh/legacyMesh.js';

const { autoUpdater } = autoUpdaterPkg;
const LEGACY_POS_PRODUCT_ID = 'hospitality-pos';

// ── Offline Inventory Reservation Helpers ────────────────────────────────────
function readInventoryCache() { return readArrayCacheForCurrentLodge('inventory-items'); }
function readMenuCache() { return readArrayCacheForCurrentLodge('pos-menu-items'); }
function writeInventoryCache(rows) { writeCache('inventory-items', rows); }

function normalizeInventoryStockValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function resolveInventoryItemForOrderItem(item) {
  if (item.inventory_item_id) {
    const inv = readInventoryCache().find((i) => i.id === item.inventory_item_id);
    return inv ? { ...inv, depletion_qty: Number(item.depletion_qty) || 1 } : null;
  }
  const menuItems = readMenuCache();
  const menu = menuItems.find((m) => m.id === item.menu_item_id);
  if (menu?.inventory_item_id) {
    const inv = readInventoryCache().find((i) => i.id === menu.inventory_item_id);
    return inv ? { ...inv, depletion_qty: Number(item.depletion_qty) || Number(menu.depletion_qty) || 1 } : null;
  }
  const itemName = String(item.item_name || '').toLowerCase();
  const inv = readInventoryCache().find((i) => String(i.name || '').toLowerCase() === itemName);
  return inv ? { ...inv, depletion_qty: Number(item.depletion_qty) || 1 } : null;
}

function buildOfflineInventoryUsage(items = []) {
  const usage = new Map();
  for (const item of items) {
    const inv = resolveInventoryItemForOrderItem(item);
    if (!inv) continue;
    const qty = Number(item.quantity) || 0;
    const used = qty * inv.depletion_qty;
    if (used === 0) continue;
    usage.set(inv.id, (usage.get(inv.id) || 0) + used);
  }
  return usage;
}

function applyOfflinePosInventoryReservation(items = []) {
  const usage = buildOfflineInventoryUsage(items);
  if (usage.size === 0) return [];
  refreshLegacyInventoryProjection();
  return [...usage.entries()].map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }));
}

function restoreOfflinePosInventoryReservation(items = []) {
  // Pending returns and voids are requests, not accepted stock movements.
  return [...buildOfflineInventoryUsage(items).entries()];
}

function applyQueuedLegacyInventoryReservations(rows = []) {
  const usage = new Map();
  for (const item of readSyncQueue()) {
    if (item?.functionName !== 'create_pos_order_v3' || item?.status === 'synced') continue;
    const payload = item?.payload?.payload || {};
    const orderUsage = buildOfflineInventoryUsage(payload.items || []);
    for (const [inventoryItemId, quantity] of orderUsage.entries()) {
      usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity);
    }
  }
  return (rows || []).map((item) => {
    const reserved = usage.get(item?.id) || 0;
    const syncedStock = normalizeInventoryStockValue(item.synced_current_stock ?? item.current_stock);
    return {
      ...item,
      synced_current_stock: syncedStock,
      current_stock: Math.max(0, syncedStock - reserved),
      pending_pos_reservation: reserved,
      ...(reserved ? { _pending_sync: true, _sync_state: 'pending' } : {})
    };
  });
}

function refreshLegacyInventoryProjection() {
  const projected = applyQueuedLegacyInventoryReservations(readInventoryCache());
  writeInventoryCache(projected);
  return projected;
}

// ── Cash-Up Summarizer (main-process authoritative) ────────────────────────
function getOrderPaymentRows(order = {}) {
  const breakdown = Array.isArray(order.payment_breakdown) ? order.payment_breakdown
    : typeof order.payment_breakdown === 'string'
      ? (() => { try { return JSON.parse(order.payment_breakdown); } catch { return []; } })()
      : [];
  // A legacy payment_method label is not a recorded tender allocation. Keep
  // the row visible for reconciliation, but never turn the order total into
  // an invented cash/card amount in a cash-up preview.
  return breakdown
    .map((row) => ({
      ...row,
      method: String(row?.method || row?.type || '').trim().toLowerCase(),
      amount: Number(row?.amount)
    }))
    .filter((row) => row.method && Number.isFinite(row.amount) && row.amount !== 0);
}

function hasRecordedPosTenderEnvelope(order = {}) {
  const rows = getOrderPaymentRows(order);
  const total = Number(order?.total);
  return rows.length > 0
    && Number.isFinite(total)
    && Math.abs(rows.reduce((sum, row) => sum + Number(row.amount), 0) - Math.abs(total)) <= 0.005;
}

function summarizeCashupOrders(orders = [], { openingFloat = 0 } = {}) {
  const completed = orders.filter((o) => o?.status === 'completed');
  const voided = orders.filter((o) => o?.status === 'voided');
  const byMethod = {};
  let grossSales = 0;
  let returnTotal = 0;
  let pendingCount = 0;
  let incompleteTenderCount = 0;

  for (const order of completed) {
    const total = normalizeMoney(order.total);
    const orderSign = total >= 0 ? 1 : -1;
    // A non-empty breakdown is not enough: a partial or unbalanced envelope
    // must not leak a partial cash/card amount into even a cache estimate.
    const paymentRows = hasRecordedPosTenderEnvelope(order) ? getOrderPaymentRows(order) : [];
    if (paymentRows.length === 0) incompleteTenderCount += 1;
    for (const payment of paymentRows) {
      const amount = Number(payment.amount || 0);
      const signedAmount = orderSign < 0 ? -Math.abs(amount) : Math.abs(amount);
      byMethod[payment.method] = normalizeMoney((byMethod[payment.method] || 0) + signedAmount);
    }
    if (total >= 0) grossSales = normalizeMoney(grossSales + total);
    else returnTotal = normalizeMoney(returnTotal + Math.abs(total));
    if (order._pending_sync || order._sync_state === 'pending') pendingCount += 1;
  }

  const netSales = normalizeMoney(completed.reduce((sum, o) => sum + normalizeMoney(o.total), 0));
  const cashSales = normalizeMoney(byMethod.cash || 0);
  return {
    orders_count: completed.length,
    void_count: voided.length,
    pending_count: pendingCount,
    gross_sales: grossSales,
    returns_total: returnTotal,
    net_sales: netSales,
    by_method: byMethod,
    source: 'cache',
    complete: false,
    financial_truth: 'cache_estimate',
    incomplete_tender_count: incompleteTenderCount,
    expected_cash_sales: cashSales,
    expected_cash_drawer: normalizeMoney(openingFloat + cashSales)
  };
}

function computeCashupVariances(expectedByMethod = {}, countedByMethod = {}, expectedCashDrawer = 0) {
  const normalizedExpected = expectedByMethod && typeof expectedByMethod === 'object' ? expectedByMethod : {};
  const normalizedCounted = countedByMethod && typeof countedByMethod === 'object' ? countedByMethod : {};
  const methods = new Set([...Object.keys(normalizedExpected), ...Object.keys(normalizedCounted), 'cash']);
  const varianceByMethod = {};

  for (const method of methods) {
    const counted = normalizeMoney(normalizedCounted[method] || 0);
    const expected = method === 'cash'
      ? normalizeMoney(expectedCashDrawer)
      : normalizeMoney(normalizedExpected[method] || 0);
    varianceByMethod[method] = normalizeMoney(counted - expected);
  }

  const countedCash = Number(normalizedCounted.cash) || 0;
  const cashOverShort = normalizeMoney(countedCash - normalizeMoney(expectedCashDrawer));
  varianceByMethod.cash = cashOverShort;
  return { countedCash, cashOverShort, varianceByMethod };
}

// ── Offline Session Helpers ─────────────────────────────────────────────────
function getTrustedSessionsPath() {
  return path.join(app.getPath('userData'), 'trusted-sessions.json');
}

function readTrustedSessions() {
  try { return JSON.parse(fs.readFileSync(getTrustedSessionsPath(), 'utf-8')); } catch { return []; }
}

function writeTrustedSessions(sessions) {
  try { fs.writeFileSync(getTrustedSessionsPath(), JSON.stringify(sessions, null, 2), 'utf-8'); } catch {}
}

function protectSessionSecret(value) {
  if (!value) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return {
      encrypted: true,
      value: safeStorage.encryptString(String(value)).toString('base64')
    };
  } catch {
    return null;
  }
}

function resolveSessionSecret(value) {
  if (!value) return null;
  if (typeof value === 'string') return value; // Backward compatibility; rewritten after next online login.
  try {
    if (value.encrypted !== true || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(value.value, 'base64'));
  } catch {
    return null;
  }
}

function buildTrustedSessionRecord(user, session, passwordHash, borokoSession = null) {
  const appSession = normalizeBorokoSession(borokoSession);
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    lodge_id: user.lodge_id,
    lodge_name: user.lodge_name || null,
    allowed_outlet_ids: user.allowed_outlet_ids || [],
    capability_overrides: user.capability_overrides || null,
    session_token: null,
    session_access_token: protectSessionSecret(session?.access_token),
    session_refresh_token: protectSessionSecret(session?.refresh_token),
    session_expires_at: session?.expires_at || null,
    boroko_session_token: protectSessionSecret(appSession?.token),
    boroko_session_expires_at: appSession?.expires_at || null,
    offline_password_hash: passwordHash,
    createdAt: new Date().toISOString()
  };
}

function restoreTrustedSession(email, password) {
  const sessions = readTrustedSessions();
  const now = Date.now();
  const maxAge = 14 * 24 * 60 * 60 * 1000;
  const candidates = sessions.filter((s) => {
    if (now - new Date(s.createdAt).getTime() > maxAge) return false;
    return String(s.email || '').toLowerCase() === String(email || '').toLowerCase();
  });
  if (candidates.length === 0) return { user: null, code: 'no_session' };
  const session = candidates[0];
  if (!password) return { user: null, code: 'password_required' };
  try {
    const bcrypt = require('bcryptjs');
    if (!bcrypt.compareSync(password, session.offline_password_hash)) {
      return { user: null, code: 'wrong_password' };
    }
  } catch { return { user: null, code: 'verify_failed' }; }
  const restoredUser = {
    id: session.userId,
    email: session.email,
    name: session.name,
    role: session.role,
    status: 'active',
    lodge_id: session.lodge_id,
    lodge_name: session.lodge_name || null,
    allowed_outlet_ids: session.allowed_outlet_ids || [],
    capability_overrides: session.capability_overrides || null
  };
  const accessToken = resolveSessionSecret(session.session_access_token || session.session_token);
  const refreshToken = resolveSessionSecret(session.session_refresh_token);
  const authSession = accessToken || refreshToken
    ? {
        access_token: accessToken || '',
        refresh_token: refreshToken || '',
        expires_at: session.session_expires_at || null
      }
    : null;
  const borokoSession = normalizeBorokoSession({
    session_token: resolveSessionSecret(session.boroko_session_token),
    session_expires_at: session.boroko_session_expires_at
  });
  return { user: restoredUser, code: 'ok', authSession, borokoSession };
}

function saveTrustedSession(user, session, password, borokoSession = null) {
  try {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(password, 10);
    const sessions = readTrustedSessions().filter((s) => s.userId !== user.id);
    sessions.push(buildTrustedSessionRecord(user, session, hash, borokoSession));
    writeTrustedSessions(sessions);
  } catch {}
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const devLegacyRoot = path.resolve(__dirname, '..', '..');
const devWorkspaceRoot = path.resolve(devLegacyRoot, '..');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_SELECT = 'id, auth_user_id, name, email, role, status, lodge_id, allowed_outlet_ids, capability_overrides';

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadEnvFiles() {
  const files = app.isPackaged
    ? [path.join(path.dirname(app.getPath('exe')), '.env')]
    : [
        path.join(devWorkspaceRoot, '.env'),
        path.join(devWorkspaceRoot, '.env.local'),
        path.join(devLegacyRoot, '.env'),
        path.join(devLegacyRoot, '.env.local')
      ];
  const merged = {};
  for (const filePath of files) {
    try {
      if (fs.existsSync(filePath)) Object.assign(merged, dotenv.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch {}
  }
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFiles();

function installFetchCompat() {
  if (typeof globalThis.fetch === 'undefined') globalThis.fetch = fetch;
  if (typeof globalThis.Headers === 'undefined') globalThis.Headers = Headers;
  if (typeof globalThis.Request === 'undefined') globalThis.Request = Request;
  if (typeof globalThis.Response === 'undefined') globalThis.Response = Response;
  if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket;
}

installFetchCompat();

let mainWindow = null;
let customerDisplayWindow = null;
let kitchenDisplayWindow = null;

const state = {
  supabase: null,
  supabaseConfig: null,
  authSession: null,
  borokoSession: null,
  pendingBorokoSession: null,
  isOnline: false,
  currentUser: null,
  lodgeId: null,
  cacheDir: null,
  syncInProgress: false,
  localConfig: null,
  runtimeConfig: null,
  lowResource: getLowResourceConfig(),
  financialJournalHealthy: true,
  financialJournalError: '',
  meshStatus: { running: false, peerCount: 0, lastMergeAt: null, lastError: '' }
};
let legacyMeshController = null;

function getConfigPath() {
  return path.join(app.getPath('userData'), 'pos-config.json');
}

function readLocalConfig() {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
  } catch { return null; }
}

function writeLocalConfig(config) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
    state.localConfig = config;
  } catch {}
}

function readRuntimeConfig() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'legacy-pos-runtime-config.json'),
        path.join(path.dirname(app.getPath('exe')), 'legacy-pos-runtime-config.json')
      ]
    : [
        path.join(devLegacyRoot, 'build', 'generated', 'legacy-pos-runtime-config.json')
      ];

  for (const filePath of candidates) {
    const config = readJsonFile(filePath);
    if (config?.supabaseUrl && config?.supabaseAnonKey) {
      return { url: config.supabaseUrl, key: config.supabaseAnonKey, source: 'runtime' };
    }
  }
  return null;
}

function readEnvConfig() {
  const url = process.env.VITE_SUPABASE_URL || '';
  const key = process.env.VITE_SUPABASE_KEY || '';
  return url && key ? { url, key, source: 'env' } : null;
}

function normalizeSupabaseConfig(config, source = 'unknown') {
  const url = config?.url || config?.supabaseUrl || '';
  const key = config?.key || config?.supabaseAnonKey || '';
  return url && key ? { url, key, source: config?.source || source } : null;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeUuid(value) {
  const id = String(value || '').trim().toLowerCase();
  return UUID_PATTERN.test(id) ? id : null;
}

function normalizeBorokoSession(session = null) {
  const token = String(session?.token || session?.session_token || '').trim();
  if (!token) return null;
  return {
    token,
    expires_at: session?.expires_at || session?.session_expires_at || null,
    session_type: session?.session_type || 'desktop'
  };
}

function borokoSessionIsUsable(session = null) {
  const normalized = normalizeBorokoSession(session);
  if (!normalized?.token) return false;
  if (!normalized.expires_at) return true;
  const expiresAt = Date.parse(normalized.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000;
}

function normalizeUserProfile(user, authUser = null) {
  if (!user || typeof user !== 'object') return null;
  const {
    session_token: _sessionToken,
    session_expires_at: _sessionExpiresAt,
    session_refresh_token: _sessionRefreshToken,
    access_token: _accessToken,
    refresh_token: _refreshToken,
    password_hash: _passwordHash,
    offline_password_hash: _offlinePasswordHash,
    pin_hash: _pinHash,
    ...safeUser
  } = user;
  return {
    ...safeUser,
    id: normalizeUuid(user.id) || user.id || authUser?.id || null,
    auth_user_id: normalizeUuid(user.auth_user_id || authUser?.id),
    email: normalizeEmail(user.email || authUser?.email),
    role: String(user.role || '').trim().toLowerCase(),
    status: String(user.status || 'active').trim().toLowerCase(),
    lodge_id: normalizeUuid(user.lodge_id),
    lodge_name: user.lodge_name || user.company_name || null,
    allowed_outlet_ids: Array.isArray(user.allowed_outlet_ids) ? user.allowed_outlet_ids : []
  };
}

function hasLodgeContext() {
  return Boolean(normalizeUuid(state.lodgeId));
}

function requireLodgeContext() {
  if (!hasLodgeContext()) {
    throw new Error('This POS login is not linked to a lodge. Sign out, sign in again, or ask an administrator to link this staff profile.');
  }
  state.lodgeId = normalizeUuid(state.lodgeId);
  return state.lodgeId;
}

async function lookupUserProfileBy(column, value, authUser) {
  if (!value) return null;
  let query = state.supabase.from('users').select(USER_SELECT).limit(1);
  query = column === 'email' ? query.ilike('email', value) : query.eq(column, value);
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return normalizeUserProfile(data, authUser);
}

function isMissingRpcError(error) {
  return /could not find the function|schema cache|function .* does not exist|pgrst202/i.test(String(error?.message || ''));
}

async function resolveCurrentUserProfileViaRpc(authUser, lodgeId = null) {
  const { data, error } = await state.supabase.rpc('resolve_legacy_pos_staff_profile', {
    p_lodge_id: normalizeUuid(lodgeId)
  });
  if (error) {
    if (isMissingRpcError(error)) return null;
    throw new Error(error.message || 'Could not resolve the POS staff profile.');
  }
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  const row = rows[0] || null;
  const profile = normalizeUserProfile(row, authUser);
  const borokoSession = normalizeBorokoSession(row);
  if (profile && borokoSession?.token) state.pendingBorokoSession = borokoSession;
  return profile;
}

async function resolveCurrentUserProfile(authUser) {
  if (!state.supabase || !authUser?.id) return null;
  state.pendingBorokoSession = null;
  const authId = normalizeUuid(authUser.id);
  const email = normalizeEmail(authUser.email);
  const profile =
    await resolveCurrentUserProfileViaRpc(authUser, state.lodgeId) ||
    await lookupUserProfileBy('auth_user_id', authId, authUser) ||
    await lookupUserProfileBy('id', authId, authUser) ||
    await lookupUserProfileBy('email', email, authUser);
  if (!profile) {
    throw new Error('Login succeeded, but this Supabase account is not linked to a Tsa Bonno staff profile.');
  }
  if (profile.status && !['active', 'enabled'].includes(profile.status)) {
    throw new Error(`This staff account is ${profile.status}. Ask an administrator to reactivate it.`);
  }
  if (!profile.lodge_id) {
    throw new Error('Login succeeded, but this staff profile is not linked to a lodge.');
  }
  return profile;
}

async function issueLegacyBorokoSession(profile) {
  const pending = normalizeBorokoSession(state.pendingBorokoSession);
  state.pendingBorokoSession = null;
  if (borokoSessionIsUsable(pending)) return pending;
  if (!state.supabase || !profile?.lodge_id) return null;
  try {
    const { data, error } = await state.supabase.rpc('authenticate_user_from_supabase', {
      p_lodge_id: profile.lodge_id,
      p_session_type: 'desktop'
    });
    if (error) {
      if (isMissingRpcError(error)) return null;
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.authenticated === false || row?.found === false) return null;
    return normalizeBorokoSession(row);
  } catch (error) {
    if (isMissingRpcError(error)) return null;
    throw new Error(error?.message || 'Could not issue Tsa Bonno app session.');
  }
}

function requireBorokoSession(session) {
  const normalized = normalizeBorokoSession(session);
  if (!normalized?.token) {
    throw new Error('Login succeeded, but the database did not issue a Tsa Bonno app session for this lodge. Apply the legacy POS app-session migration, then sign in again.');
  }
  return normalized;
}

function resolveSupabaseConfig() {
  const local = normalizeSupabaseConfig(state.localConfig || readLocalConfig(), 'local');
  if (local) return local;
  const runtime = normalizeSupabaseConfig(state.runtimeConfig || readRuntimeConfig(), 'runtime');
  if (runtime) return runtime;
  return readEnvConfig();
}

function buildSupabaseGlobalOptions() {
  const headers = {};
  if (state.borokoSession?.token) {
    headers['x-boroko-session'] = state.borokoSession.token;
    headers['x-boroko-session-token'] = state.borokoSession.token;
  }
  return Object.keys(headers).length > 0
    ? { fetch: globalThis.fetch, headers }
    : { fetch: globalThis.fetch };
}

function initSupabase(url, key) {
  if (!url || !key) return false;
  installFetchCompat();
  state.supabaseConfig = { url, key };
  state.supabase = createClient(url, key, {
    global: buildSupabaseGlobalOptions(),
    realtime: { transport: WebSocket },
    auth: { persistSession: false, autoRefreshToken: true }
  });
  state.isOnline = true;
  return true;
}

async function applySupabaseContext({ authSession = state.authSession, borokoSession = state.borokoSession } = {}) {
  const config = state.supabaseConfig || resolveSupabaseConfig();
  if (!config?.url || !config?.key) return false;
  state.authSession = authSession || null;
  state.borokoSession = normalizeBorokoSession(borokoSession);
  initSupabase(config.url, config.key);
  if (state.authSession?.access_token && state.authSession?.refresh_token) {
    const { error } = await state.supabase.auth.setSession(state.authSession);
    if (error) throw new Error(error.message);
  }
  return true;
}

function getCacheDir() {
  const userDataPath = app.getPath('userData');
  const dir = path.join(userDataPath, 'pos-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readCache(name) {
  const filePath = path.join(state.cacheDir, `${name}.json`);
  const tmpPath = filePath + '.tmp';
  if (fs.existsSync(tmpPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
      fs.renameSync(tmpPath, filePath);
      return data;
    } catch { try { fs.unlinkSync(tmpPath); } catch {} }
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return []; }
}

function cacheRowBelongsToLodge(row, lodgeId, strict = false) {
  if (!lodgeId) return true;
  const rowLodgeId = normalizeUuid(row?.lodge_id);
  if (!rowLodgeId) return !strict;
  return rowLodgeId === lodgeId;
}

function readArrayCacheForCurrentLodge(name, { strict = true } = {}) {
  const rows = readCache(name);
  if (!Array.isArray(rows)) return [];
  const lodgeId = normalizeUuid(state.lodgeId);
  if (!lodgeId) return rows;
  return rows.filter((row) => cacheRowBelongsToLodge(row, lodgeId, strict));
}

function readObjectCacheForCurrentLodge(name, { strict = true } = {}) {
  const cached = readCache(name);
  if (!cached || Array.isArray(cached) || typeof cached !== 'object') return null;
  const lodgeId = normalizeUuid(state.lodgeId);
  return cacheRowBelongsToLodge(cached, lodgeId, strict) ? cached : null;
}

function writeCache(name, data) {
  const filePath = path.join(state.cacheDir, `${name}.json`);
  const tmpPath = filePath + '.tmp';
  const financialCache = new Set([
    'sync-queue', 'pos-orders', 'pos-cashups', 'pos-shifts', 'inventory-items'
  ]).has(name);
  try {
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(data, null, 2), null, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch {}
    if (financialCache) throw new Error(`Could not durably save ${name}: ${e.message}`);
    console.warn(`[POS Cache] Could not save ${name}:`, e?.message || e);
  }
}

function readSyncQueue() { return readCache('sync-queue'); }
function writeSyncQueue(queue) { writeCache('sync-queue', queue); }

const FINANCIAL_QUEUE_TYPES = new Set([
  'pos_order', 'pos_return', 'pos_void', 'pos_cashup', 'pos_shift_open', 'pos_shift_close'
]);

function isFinancialQueueItem(item) {
  return FINANCIAL_QUEUE_TYPES.has(item?.entityType);
}

function ensureFinancialJournalReady() {
  if (!state.financialJournalHealthy) {
    throw new Error(`Financial operations are locked because the local journal needs repair: ${state.financialJournalError}`);
  }
}

function enqueueLegacyQueueItem(queueItem) {
  const financial = isFinancialQueueItem(queueItem);
  if (financial) ensureFinancialJournalReady();
  const protectedItem = {
    ...queueItem,
    payload: protectLegacyQueuePayload(queueItem.payload)
  };
  if (financial) {
    appendFinancialJournalEvent(state.cacheDir, {
      event_type: 'queue_operation',
      queue_item_id: protectedItem.id,
      queue_item: protectedItem
    });
  }
  const queue = readSyncQueue();
  if (!queue.some((item) => item.id === protectedItem.id)) queue.push(protectedItem);
  writeSyncQueue(queue);
  return protectedItem;
}

function journalQueueState(item, patch) {
  if (!isFinancialQueueItem(item)) return;
  appendFinancialJournalEvent(state.cacheDir, {
    event_type: 'queue_state',
    queue_item_id: item.id,
    patch
  });
}

function recoverFinancialQueue() {
  try {
    const recovered = rebuildFinancialQueueFromJournal(state.cacheDir);
    const existing = readSyncQueue();
    const nonFinancial = existing.filter((item) => !isFinancialQueueItem(item));
    const byId = new Map(recovered.map((item) => [item.id, item]));
    for (const item of existing.filter(isFinancialQueueItem)) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    writeSyncQueue([...nonFinancial, ...byId.values()]);
    state.financialJournalHealthy = true;
    state.financialJournalError = '';
  } catch (error) {
    state.financialJournalHealthy = false;
    state.financialJournalError = error?.message || String(error);
    console.error('[Financial Journal] Recovery failed:', error);
  }
}

function getLegacyMeshSecret() {
  const settings = readCache('settings');
  const row = Array.isArray(settings) ? settings[0] : settings;
  return String(row?.lodge_mesh_secret || '').trim();
}

function getLegacyMeshEntity(item = {}) {
  const payload = item.data?.payload || {};
  if (item.table === 'create_pos_order_v3') return { entityType: 'pos_order', entityId: payload.id };
  if (item.table === 'finalize_pos_shift_cashup_v2') return { entityType: 'pos_cashup', entityId: payload.cashup_id };
  if (item.table === 'upsert_pos_tab' || item.table === 'update_pos_tab_status') {
    return { entityType: 'pos_tab', entityId: payload.id || item.data?.p_tab_id };
  }
  if (item.table === 'upsert_pos_table') return { entityType: 'pos_table', entityId: payload.id };
  if (item.table === 'open_pos_shift_with_id') return { entityType: 'pos_shift_open', entityId: payload.id };
  if (item.table === 'close_pos_shift_with_id') return { entityType: 'pos_shift_close', entityId: payload.id };
  return {
    entityType: item._legacy_entity_type || 'pos_config',
    entityId: item._legacy_entity_id || payload.id || item.id || item._queue_id
  };
}

function cacheImportedLegacyMeshOperation(item = {}) {
  const payload = item.data?.payload || {};
  if (item.table === 'create_pos_order_v3' && payload.id) {
    const orders = readCache('pos-orders');
    if (!orders.some((row) => row?.id === payload.id)) {
      const menu = readMenuCache();
      const displayItems = (payload.items || []).map((line) => {
        const menuItem = menu.find((row) => row?.id === line.menu_item_id) || {};
        return {
          id: randomUUID(),
          order_id: payload.id,
          menu_item_id: line.menu_item_id,
          item_name: menuItem.name || 'Pending mesh sale item',
          quantity: Number(line.quantity || 0),
          unit_price: Number(menuItem.price || 0),
          subtotal: Number(line.quantity || 0) * Number(menuItem.price || 0),
          inventory_item_id: menuItem.inventory_item_id || null,
          depletion_qty: menuItem.depletion_qty || 1
        };
      });
      const totals = buildPosTotals(displayItems, payload);
      orders.unshift({
        ...payload,
        total: totals.total,
        gross_total: totals.gross_total,
        discount_total: totals.discount_total,
        tax_total: totals.tax_total,
        status: 'pending',
        created_at: payload.client_created_at || item.timestamp || new Date().toISOString(),
        _pending_sync: true,
        _sync_state: 'pending',
        _mesh_imported: true,
        _mesh_source_node_id: item._mesh_source_node_id,
        pos_order_items: displayItems
      });
      writeCache('pos-orders', orders);
    }
  }
}

function importLegacyMeshItems(items = []) {
  const existing = readSyncQueue();
  const existingIds = new Set(existing.map((item) => item.id));
  let imported = 0;
  for (const item of items) {
    if (!item?._queue_id || existingIds.has(item._queue_id)) continue;
    if (item._depends_on && !existingIds.has(item._depends_on)) continue;
    const { entityType, entityId } = getLegacyMeshEntity(item);
    enqueueLegacyQueueItem({
      id: item._queue_id,
      type: 'rpc',
      functionName: item.table,
      payload: item.data,
      status: 'pending',
      createdAt: item.timestamp || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
      dependsOn: item._depends_on || null,
      entityType,
      entityId,
      _mesh_imported: true,
      _mesh_source_node_id: item._mesh_source_node_id,
      _mesh_imported_at: item._mesh_imported_at
    });
    existingIds.add(item._queue_id);
    cacheImportedLegacyMeshOperation(item);
    imported++;
  }
  if (imported > 0) refreshLegacyInventoryProjection();
  return imported;
}

function startLegacyMesh() {
  if (legacyMeshController || !state.cacheDir) return;
  legacyMeshController = createLegacyMeshController({
    cacheDir: state.cacheDir,
    getLodgeId: () => state.lodgeId,
    getMeshSecret: getLegacyMeshSecret,
    readQueue: readSyncQueue,
    importCanonicalItems: importLegacyMeshItems,
    onStatus: (status) => {
      state.meshStatus = status;
    }
  });
  legacyMeshController.start();
}

// ── GitHub Release Updates ─────────────────────────────────────────────────
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

const UPDATE_STARTUP_DELAY_MS = 8000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const HEALTH_REPORT_INTERVAL_MS = 15 * 60 * 1000;
let autoUpdaterStarted = false;
let updateCheckInterval = null;
let healthReportInterval = null;

const updateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  version: null,
  releaseName: '',
  releaseDate: '',
  releaseNotes: '',
  progress: null,
  error: ''
};

function normalizeReleaseNotes(notes) {
  if (!notes) return '';
  if (typeof notes === 'string') return notes.trim();
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (!entry || typeof entry !== 'object') return '';
        return String(entry.note || entry.text || entry.name || '').trim();
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
  if (typeof notes === 'object') return String(notes.note || notes.text || notes.name || '').trim();
  return String(notes).trim();
}

function formatUpdateError(error) {
  const message = String(error?.message || error || '').trim();
  const lower = message.toLowerCase();
  if (
    lower.includes('err_cert_authority_invalid') ||
    lower.includes('self signed certificate') ||
    lower.includes('unable to verify') ||
    lower.includes('certificate')
  ) {
    return 'Update check could not verify the GitHub certificate. On older POS Windows machines, install current Windows root certificates or check whether antivirus/proxy SSL inspection is replacing GitHub certificates, then try again.';
  }
  return message || 'Could not check for updates.';
}

function setUpdateState(patch = {}) {
  Object.assign(updateState, patch);
  updateState.currentVersion = app.getVersion();
  return { ...updateState };
}

function broadcastUpdate(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function getUpdateInstallSafety() {
  const queue = Array.isArray(readSyncQueue()) ? readSyncQueue() : [];
  const pendingItems = queue.filter((item) => ['pending', 'syncing'].includes(item.status));
  const failedItems = queue.filter((item) => ['failed', 'manual_review_required'].includes(item.status));
  const openShifts = (Array.isArray(readCache('pos-shifts')) ? readCache('pos-shifts') : [])
    .filter((shift) => String(shift?.status || '').toLowerCase() === 'open');
  const openTabs = (Array.isArray(readCache('pos-tabs')) ? readCache('pos-tabs') : [])
    .filter((tab) => ['open', 'running', 'ready', 'delivered'].includes(String(tab?.status || '').toLowerCase()));
  const unfinalizedCashups = openShifts.filter((shift) =>
    !(readCache('pos-cashups') || []).some((cashup) =>
      cashup?.shift_id === shift.id && !cashup?._pending_sync
    )
  );
  const blockers = [];

  if (pendingItems.length > 0) blockers.push(`${pendingItems.length} pending sync item(s)`);
  if (failedItems.length > 0) blockers.push(`${failedItems.length} failed/manual review sync item(s)`);
  if (openShifts.length > 0) blockers.push(`${openShifts.length} open shift(s)`);
  if (openTabs.length > 0) blockers.push(`${openTabs.length} open table/tab(s)`);
  if (unfinalizedCashups.length > 0) blockers.push(`${unfinalizedCashups.length} unfinalized cash-up(s)`);

  return {
    blocked: blockers.length > 0,
    blockers,
    pendingCount: pendingItems.length,
    failedCount: failedItems.length,
    openShiftCount: openShifts.length,
    openTabCount: openTabs.length,
    unfinalizedCashupCount: unfinalizedCashups.length
  };
}

function getLegacyPosDeviceId() {
  try {
    const source = app?.getPath?.('userData') || 'boroko-legacy-pos';
    return `legacy-${createHash('sha256').update(String(source)).digest('hex').slice(0, 24)}`;
  } catch {
    return 'legacy-pos-unknown';
  }
}

function getCachedLegacyCatalog(outletId = null) {
  const rows = readCache('pos-catalog-snapshots');
  return (Array.isArray(rows) ? rows : []).find((row) =>
    row?.success === true &&
    row?.snapshot_id &&
    (row?.outlet_id || null) === (outletId || null)
  ) || null;
}

async function getActiveLegacyCatalog(outletId = null) {
  if (!state.isOnline || !state.supabase) {
    const cached = getCachedLegacyCatalog(outletId);
    if (cached) return cached;
    throw new Error('No catalog snapshot is available offline. Connect and publish the POS catalog first.');
  }
  const { data, error } = await state.supabase.rpc('get_active_pos_catalog_snapshot', {
    p_lodge_id: requireLodgeContext(),
    p_outlet_id: outletId || null
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'No active POS catalog is available.');
  const rows = readCache('pos-catalog-snapshots');
  writeCache('pos-catalog-snapshots', [
    data,
    ...(Array.isArray(rows) ? rows : []).filter((row) =>
      (row?.outlet_id || null) !== (outletId || null)
    )
  ]);
  return data;
}

async function publishLegacyCatalog(outletId = null) {
  if (!state.isOnline || !state.supabase) {
    throw new Error('Catalog publication requires an internet connection.');
  }
  const { data, error } = await state.supabase.rpc('publish_pos_catalog_snapshot', {
    p_lodge_id: requireLodgeContext(),
    p_outlet_id: outletId || null
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not publish the POS catalog.');
  return getActiveLegacyCatalog(outletId);
}

async function publishAllLegacyCatalogs() {
  const targets = new Set([null]);
  for (const outlet of readCache('outlets') || []) {
    if (outlet?.id) targets.add(outlet.id);
  }
  for (const outletId of targets) {
    await publishLegacyCatalog(outletId);
  }
}

function getLastSuccessfulPosSyncAt(queue = []) {
  let max = 0;
  for (const item of queue) {
    if (item?.status !== 'synced') continue;
    const time = new Date(item.updatedAt || item.syncedAt || item.createdAt || 0).getTime();
    if (Number.isFinite(time) && time > max) max = time;
  }
  return max ? new Date(max).toISOString() : null;
}

function getLegacyPosFaultTypes(queue = []) {
  return [...new Set(queue
    .filter((item) => ['failed', 'manual_review_required'].includes(item.status))
    .map((item) => item.entityType || item.functionName || 'sync_failure')
    .filter(Boolean))]
    .slice(0, 10);
}

async function publishLegacyPosDeviceHealth() {
  if (!state.isOnline || !state.supabase || !state.lodgeId) return { success: false, skipped: true };
  const queue = Array.isArray(readSyncQueue()) ? readSyncQueue() : [];
  const pendingCount = queue.filter((item) => ['pending', 'syncing'].includes(item.status)).length;
  const failedItems = queue.filter((item) => ['failed', 'manual_review_required'].includes(item.status));
  const failedCount = failedItems.length;
  const safety = getUpdateInstallSafety();
  const reconciliationState = failedCount > 0 ? 'mismatch' : pendingCount > 0 ? 'unverifiable' : 'clear';
  try {
    const { data, error } = await state.supabase.rpc('upsert_device_health', {
      p_lodge_id: state.lodgeId,
      p_device_id: getLegacyPosDeviceId(),
      p_client_type: 'legacy_pos',
      p_pending_queue_count: pendingCount,
      p_failed_queue_count: failedCount,
      p_unresolved_local_count: failedCount,
      p_replay_auth_ready: true,
      p_last_successful_sync_at: getLastSuccessfulPosSyncAt(queue),
      p_reconciliation_state: reconciliationState,
      p_top_fault_types: getLegacyPosFaultTypes(queue),
      p_raw_summary: {
        appVersion: app.getVersion(),
        pendingCount,
        failedCount,
        openShiftCount: safety.openShiftCount,
        blockers: safety.blockers,
        lowResource: state.lowResource
      }
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data.error || 'Could not publish POS health');
    return { success: true };
  } catch (error) {
    console.warn('[POS Health] publish failed:', error?.message || error);
    return { success: false, error: error?.message || String(error) };
  }
}

async function gatePosUpdateCheck() {
  if (!state.supabase || !state.isOnline) return true;
  try {
    const { data, error } = await state.supabase.rpc('app_check_product_update_availability', {
      p_product_id: LEGACY_POS_PRODUCT_ID,
      p_current_version: app.getVersion(),
      p_device_id: getLegacyPosDeviceId()
    });
    if (error) throw error;
    if (data?.update_available === false) {
      setUpdateState({ phase: 'uptodate', version: data.latest_version || app.getVersion(), error: '', progress: null });
      return false;
    }
    return data?.update_available !== false;
  } catch (error) {
    console.warn('[POS Updater] Command Central gate failed, allowing fallback:', error?.message || error);
    return true;
  }
}

async function checkForPosUpdates() {
  if (!app.isPackaged) {
    const devState = setUpdateState({ phase: 'dev', error: '', progress: null });
    return { success: true, updateAvailable: false, dev: true, state: devState };
  }
  if (!state.isOnline) {
    const offlineState = setUpdateState({
      phase: 'offline',
      error: 'Connect to the internet before checking for updates.',
      progress: null
    });
    return { success: false, offline: true, error: offlineState.error, state: offlineState };
  }
  try {
    setUpdateState({ phase: 'checking', error: '', progress: null });
    const allowed = await gatePosUpdateCheck();
    if (!allowed) {
      return { success: true, updateAvailable: false, gated: true, state: { ...updateState } };
    }
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo || {};
    const latestVersion = info.version || null;
    const updateAvailable = Boolean(latestVersion && latestVersion !== app.getVersion());
    return {
      success: true,
      updateAvailable,
      latestVersion,
      releaseName: info.releaseName || '',
      releaseDate: info.releaseDate || '',
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      state: { ...updateState }
    };
  } catch (error) {
    const next = setUpdateState({
      phase: 'error',
      error: formatUpdateError(error),
      progress: null
    });
    return { success: false, error: next.error, state: next };
  }
}

function setupAutoUpdater() {
  if (autoUpdaterStarted) return;
  autoUpdaterStarted = true;

  autoUpdater.on('update-available', (info) => {
    const payload = setUpdateState({
      phase: 'available',
      version: info.version,
      releaseName: info.releaseName || '',
      releaseDate: info.releaseDate || '',
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      progress: null,
      error: ''
    });
    broadcastUpdate('pos:update-available', payload);
  });

  autoUpdater.on('update-not-available', (info) => {
    const payload = setUpdateState({
      phase: 'uptodate',
      version: info?.version || app.getVersion(),
      releaseName: '',
      releaseDate: '',
      releaseNotes: '',
      progress: null,
      error: ''
    });
    broadcastUpdate('pos:update-not-available', payload);
  });

  autoUpdater.on('download-progress', (progress) => {
    const progressPayload = {
      percent: Math.round(progress.percent || 0),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    };
    const payload = setUpdateState({
      phase: 'downloading',
      progress: progressPayload,
      error: ''
    });
    broadcastUpdate('pos:update-progress', payload);
  });

  autoUpdater.on('update-downloaded', (info) => {
    const payload = setUpdateState({
      phase: 'ready',
      version: info.version || updateState.version,
      releaseName: info.releaseName || updateState.releaseName,
      releaseDate: info.releaseDate || updateState.releaseDate,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes) || updateState.releaseNotes,
      error: ''
    });
    broadcastUpdate('pos:update-ready', { ...payload, safety: getUpdateInstallSafety() });
  });

  autoUpdater.on('error', (error) => {
    const payload = setUpdateState({
      phase: 'error',
      error: formatUpdateError(error),
      progress: null
    });
    broadcastUpdate('pos:update-error', { ...payload, message: payload.error });
  });

  if (!app.isPackaged) return;

  setTimeout(() => {
    if (state.isOnline) {
      publishLegacyPosDeviceHealth().catch(() => {});
      checkForPosUpdates().catch(() => {});
    }
  }, UPDATE_STARTUP_DELAY_MS);
  updateCheckInterval = setInterval(() => {
    if (state.isOnline) checkForPosUpdates().catch(() => {});
  }, UPDATE_CHECK_INTERVAL_MS);
  healthReportInterval = setInterval(() => {
    if (state.isOnline) publishLegacyPosDeviceHealth().catch(() => {});
  }, HEALTH_REPORT_INTERVAL_MS);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 600,
    title: 'Tsa Bonno POS Legacy',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (customerDisplayWindow) { customerDisplayWindow.close(); customerDisplayWindow = null; }
    if (kitchenDisplayWindow) { kitchenDisplayWindow.close(); kitchenDisplayWindow = null; }
  });
  return mainWindow;
}

function createDisplayWindow(route, title) {
  const existing = route === 'customer' ? customerDisplayWindow : kitchenDisplayWindow;
  if (existing && !existing.isDestroyed()) { existing.focus(); return existing; }
  const win = new BrowserWindow({
    width: 1024, height: 768, title,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#/${route}`);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: `/${route}` });
  }
  if (route === 'customer') customerDisplayWindow = win;
  else kitchenDisplayWindow = win;
  win.on('closed', () => {
    if (route === 'customer') customerDisplayWindow = null;
    else kitchenDisplayWindow = null;
  });
  return win;
}

function patchLocalOrderState(orderId, patch) {
  const cached = readCache('pos-orders');
  const idx = cached.findIndex((o) => o.id === orderId);
  if (idx < 0) return false;
  cached[idx] = { ...cached[idx], ...patch };
  writeCache('pos-orders', cached);
  return true;
}

function patchLocalCashupState(cashupId, patch) {
  const cached = readCache('pos-cashups');
  const idx = cached.findIndex((c) => c.id === cashupId);
  if (idx < 0) return false;
  cached[idx] = { ...cached[idx], ...patch };
  writeCache('pos-cashups', cached);
  return true;
}

function patchLocalTicketState(ticketId, patch) {
  const cached = readCache('pos-tickets');
  const idx = cached.findIndex((t) => t.id === ticketId);
  if (idx < 0) return false;
  cached[idx] = { ...cached[idx], ...patch };
  writeCache('pos-tickets', cached);
  return true;
}

function mergeOrders(remoteRows = [], localRows = []) {
  const remoteIds = new Set((remoteRows || []).map((r) => r?.id).filter(Boolean));
  const pendingLocal = (localRows || []).filter(
    (r) => r?._pending_sync || ['pending', 'failed', 'manual_review_required'].includes(String(r?._sync_state || ''))
  ).filter((r) => r?.id && !remoteIds.has(r.id));
  return [...pendingLocal, ...(remoteRows || [])];
}

function applyOutletFilter(rows, outletFilter) {
  if (outletFilter === null) return rows;
  if (!Array.isArray(outletFilter) || outletFilter.length === 0) return [];
  return (rows || []).filter((r) => !r.outlet_id || outletFilter.includes(r.outlet_id));
}

function getUserOutletFilter() {
  const user = state.currentUser;
  if (!user) return [];
  const role = String(user.role || '').toLowerCase();
  if (['manager', 'admin', 'super_admin', 'administrator', 'superadmin'].includes(role)) return null;
  return Array.isArray(user.allowed_outlet_ids) ? user.allowed_outlet_ids : [];
}

async function refreshRemoteOrders() {
  if (!state.isOnline || !state.supabase || !hasLodgeContext()) return;
  try {
    const { data } = await state.supabase
      .from('pos_orders')
      .select('id, room_id, booking_id, walk_in_name, total, gross_total, discount_total, tax_rate, tax_total, tip_total, notes, payment_method, payment_breakdown, outlet_id, service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name, shift_id, ticket_status, status, created_at, pos_order_items(*), outlets(name)')
      .eq('lodge_id', requireLodgeContext())
      .order('created_at', { ascending: false })
      .limit(state.lowResource.ordersLimit);
    if (data) writeCache('pos-orders', mergeOrders(data, readCache('pos-orders')));
  } catch {}
}

function appendPrepTickets(order, items = []) {
  const positiveItems = (items || []).filter((item) => (Number(item.quantity) || 0) > 0);
  if (positiveItems.length === 0) return;
  const tickets = readCache('pos-tickets');
  tickets.unshift({
    id: `ticket-${order.id || randomUUID()}`,
    order_id: order.id,
    lodge_id: normalizeUuid(state.lodgeId),
    table_name: order.table_name || null,
    tab_name: order.tab_name || null,
    waiter_name: order.waiter_name || null,
    room_id: order.room_id || null,
    notes: order.notes || null,
    status: 'new',
    items: positiveItems.map((item) => ({
      item_name: item.item_name,
      quantity: item.quantity,
      modifiers: item.modifiers || [],
      item_notes: item.item_notes || null
    })),
    created_at: new Date().toISOString()
  });
  writeCache('pos-tickets', tickets);
}

function isCashOrder(order = {}) {
  if (String(order.payment_method || '').toLowerCase() === 'cash') return true;
  const payments = Array.isArray(order.payment_breakdown) ? order.payment_breakdown : [];
  return payments.some((p) => String(p.method || '').toLowerCase() === 'cash' && Number(p.amount || 0) > 0);
}

function formatAuthLoginError(error) {
  const message = String(error?.message || 'Login failed.');
  if (/email not confirmed/i.test(message)) {
    return 'This staff email is not confirmed in Supabase Auth. Reset this staff member password in Tsa Bonno desktop or Command Central, then try again.';
  }
  return message;
}

function registerIpcHandlers() {
  // ── Auth ───────────────────────────────────────────────────────────────────
  ipcMain.handle('pos:auth-login', async (_event, { email, password }) => {
    if (!state.supabase) throw new Error('Supabase not configured');
    const { data, error } = await state.supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
    if (error) throw new Error(formatAuthLoginError(error));
    const userData = await resolveCurrentUserProfile(data.user);
    const borokoSession = requireBorokoSession(await issueLegacyBorokoSession(userData));
    await applySupabaseContext({ authSession: data.session, borokoSession });
    state.currentUser = userData;
    state.lodgeId = userData.lodge_id;
    writeCache('current-session', { user: state.currentUser, lodgeId: state.lodgeId, session: data.session, borokoSession: state.borokoSession, savedAt: new Date().toISOString() });
    saveTrustedSession(userData, data.session, password, state.borokoSession);
    publishLegacyPosDeviceHealth().catch(() => {});
    return { user: state.currentUser, lodgeId: state.lodgeId };
  });

  ipcMain.handle('pos:auth-restore', async (_event, credentials) => {
    const saved = readCache('current-session');
    if (saved?.session?.access_token && state.supabase) {
      try {
        await applySupabaseContext({ authSession: saved.session, borokoSession: saved.borokoSession });
        {
          const { data: authData } = await state.supabase.auth.getUser().catch(() => ({ data: null }));
          const authUser = authData?.user || saved.session?.user || saved.user;
          const userData = await resolveCurrentUserProfile(authUser);
          const borokoSession = requireBorokoSession(await issueLegacyBorokoSession(userData) || state.borokoSession);
          await applySupabaseContext({ authSession: saved.session, borokoSession });
          state.currentUser = userData;
          state.lodgeId = userData.lodge_id;
          writeCache('current-session', { user: state.currentUser, lodgeId: state.lodgeId, session: saved.session, borokoSession: state.borokoSession, savedAt: new Date().toISOString() });
          publishLegacyPosDeviceHealth().catch(() => {});
          return { user: state.currentUser, lodgeId: state.lodgeId };
        }
      } catch {}
    }
    if (credentials?.email && credentials?.password) {
      const result = restoreTrustedSession(credentials.email, credentials.password);
      if (result.code === 'ok' && result.user) {
        state.currentUser = result.user;
        state.lodgeId = result.user.lodge_id;
        if (result.authSession || result.borokoSession) {
          await applySupabaseContext({ authSession: result.authSession, borokoSession: result.borokoSession }).catch(() => {});
        }
        writeCache('current-session', { user: state.currentUser, lodgeId: state.lodgeId, session: result.authSession || null, borokoSession: state.borokoSession, savedAt: new Date().toISOString() });
        publishLegacyPosDeviceHealth().catch(() => {});
        return { user: state.currentUser, lodgeId: state.lodgeId };
      }
      if (result.code === 'wrong_password') throw new Error('Wrong password.');
      if (result.code === 'no_session') throw new Error('No saved session found. Please connect to the internet to sign in.');
    }
    state.currentUser = null;
    state.lodgeId = null;
    state.authSession = null;
    state.borokoSession = null;
    state.pendingBorokoSession = null;
    writeCache('current-session', null);
    return null;
  });

  ipcMain.handle('pos:auth-has-trusted-session', async (_event, email) => {
    if (!email) return false;
    const sessions = readTrustedSessions();
    const now = Date.now();
    const maxAge = 14 * 24 * 60 * 60 * 1000;
    return sessions.some((s) => {
      if (now - new Date(s.createdAt).getTime() > maxAge) return false;
      return String(s.email || '').toLowerCase() === String(email || '').toLowerCase();
    });
  });

  ipcMain.handle('pos:auth-logout', async () => {
    if (state.supabase) await state.supabase.auth.signOut().catch(() => {});
    state.currentUser = null;
    state.lodgeId = null;
    state.authSession = null;
    state.borokoSession = null;
    state.pendingBorokoSession = null;
    if (state.supabaseConfig?.url && state.supabaseConfig?.key) initSupabase(state.supabaseConfig.url, state.supabaseConfig.key);
    writeCache('current-session', null);
    return true;
  });

  ipcMain.handle('pos:config', async () => {
    state.localConfig = readLocalConfig();
    state.runtimeConfig = readRuntimeConfig();
    const resolved = resolveSupabaseConfig();
    const url = resolved?.url || '';
    const key = resolved?.key || '';
    return {
      url,
      key: key ? '***' : '',
      configured: Boolean(url && key),
      source: resolved?.source || null,
      localConfigExists: Boolean(state.localConfig?.url && state.localConfig?.key),
      runtimeConfigExists: Boolean(state.runtimeConfig?.url && state.runtimeConfig?.key)
    };
  });

  ipcMain.handle('pos:save-config', async (_event, { url, key }) => {
    if (!url || !key) throw new Error('Supabase URL and anon key are required.');
    writeLocalConfig({ url, key });
    initSupabase(url, key);
    return { success: true };
  });

  ipcMain.handle('pos:go-online', async () => { state.isOnline = true; return true; });
  ipcMain.handle('pos:go-offline', async () => { state.isOnline = false; return true; });
  ipcMain.handle('pos:get-is-online', () => state.isOnline);

  // ── Menu Items ─────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-menu-items', async () => {
    const outletFilter = getUserOutletFilter();
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const lodgeId = requireLodgeContext();
      const { data, error } = await state.supabase
        .from('pos_menu_items')
        .select('id, name, category, price, is_available, barcode, inventory_item_id, depletion_qty, outlet_id, template_kind, lodge_id, created_at, updated_at')
        .eq('lodge_id', lodgeId).order('category').order('name').limit(state.lowResource.menuLimit);
      if (error) throw new Error(error.message);
      if (data && data.length > 0) {
        writeCache('pos-menu-items', data || []);
        return applyOutletFilter(data || [], outletFilter);
      }
      const cached = readMenuCache();
      if (cached && cached.length > 0) return applyOutletFilter(cached, outletFilter);
      return [];
    }
    return applyOutletFilter(readMenuCache(), outletFilter);
  });

  ipcMain.handle('pos:get-menu-item-by-id', async (_event, id) => {
    if (!id) return null;
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.from('pos_menu_items').select('*')
        .eq('id', id).eq('lodge_id', requireLodgeContext()).single();
      if (error) throw error;
      return data || null;
    }
    return readMenuCache().find((item) => item.id === id) || null;
  });

  ipcMain.handle('pos:create-menu-item', async (_event, data) => {
    const lodgeId = requireLodgeContext();
    const itemId = data.id || randomUUID();
    const payload = { id: itemId, lodge_id: lodgeId, name: data.name, category: data.category || 'Other', price: Number(data.price) || 0, is_available: data.is_available !== false, barcode: data.barcode || null, inventory_item_id: data.inventory_item_id || null, depletion_qty: data.inventory_item_id ? Number(data.depletion_qty) || 1 : null, outlet_id: data.outlet_id || null };

    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('create_pos_menu_item', { payload });
        if (error) throw new Error(error.message);
        if (!result?.success) throw new Error(result?.error || 'Could not create POS menu item');
        await publishLegacyCatalog(payload.outlet_id || null);
        return { success: true, id: result?.id };
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          return queueOfflineRpcMutation('create_pos_menu_item', { payload }, 'pos_menu_item', itemId, {
            cacheName: 'pos-menu-items',
            localPatch: { id: itemId, ...data, lodge_id: lodgeId, _pending_sync: true, _sync_state: 'pending', _insert: true }
          });
        }
        throw rpcError;
      }
    }
    return queueOfflineRpcMutation('create_pos_menu_item', { payload }, 'pos_menu_item', itemId, {
      cacheName: 'pos-menu-items',
      localPatch: { id: itemId, ...data, lodge_id: lodgeId, _pending_sync: true, _sync_state: 'pending', _insert: true }
    });
  });

  ipcMain.handle('pos:update-menu-item', async (_event, id, data) => {
    const lodgeId = requireLodgeContext();
    const update = { name: data.name, category: data.category, price: Number(data.price), is_available: data.is_available, barcode: data.barcode || null, inventory_item_id: data.inventory_item_id || null, depletion_qty: data.inventory_item_id ? Number(data.depletion_qty) || 1 : null, ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {}) };
    const rpcArgs = { p_id: id, p_lodge_id: lodgeId, payload: update };

    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('update_pos_menu_item', rpcArgs);
        if (error) throw new Error(error.message);
        if (!result?.success) throw new Error(result?.error || 'Could not update POS menu item');
        await publishAllLegacyCatalogs();
        return { success: true };
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          return queueOfflineRpcMutation('update_pos_menu_item', rpcArgs, 'pos_menu_item', id, {
            cacheName: 'pos-menu-items',
            localPatch: { id, ...update, _pending_sync: true, _sync_state: 'pending', _updateKey: id }
          });
        }
        throw rpcError;
      }
    }
    return queueOfflineRpcMutation('update_pos_menu_item', rpcArgs, 'pos_menu_item', id, {
      cacheName: 'pos-menu-items',
      localPatch: { id, ...update, _pending_sync: true, _sync_state: 'pending', _updateKey: id }
    });
  });

  ipcMain.handle('pos:delete-menu-item', async (_event, id) => {
    const lodgeId = requireLodgeContext();
    const rpcArgs = { p_id: id, p_lodge_id: lodgeId };
    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('delete_pos_menu_item', rpcArgs);
        if (error) throw new Error(error.message);
        if (!result?.success) throw new Error(result?.error || 'Could not delete POS menu item');
        await publishAllLegacyCatalogs();
        return { success: true };
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          return queueOfflineRpcMutation('delete_pos_menu_item', rpcArgs, 'pos_menu_item', id, {
            cacheName: 'pos-menu-items',
            localPatch: { id, is_available: false, _pending_sync: true, _sync_state: 'pending', _updateKey: id }
          });
        }
        throw rpcError;
      }
    }
    return queueOfflineRpcMutation('delete_pos_menu_item', rpcArgs, 'pos_menu_item', id, {
      cacheName: 'pos-menu-items',
      localPatch: { id, is_available: false, _pending_sync: true, _sync_state: 'pending', _updateKey: id }
    });
  });

  ipcMain.handle('pos:set-bar-pack-template', async (_event, data) => {
    const lodgeId = requireLodgeContext();
    const payload = { lodge_id: lodgeId, inventory_item_id: data.inventory_item_id, pack_size: Number(data.pack_size), enabled: data.enabled === true };

    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('set_bar_pos_pack_template', { payload });
        if (error) throw new Error(error.message);
        if (!result?.success) throw new Error(result?.error || 'Could not update Bar POS template');
        await publishAllLegacyCatalogs();
        return { success: true };
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          return queueOfflineRpcMutation('set_bar_pos_pack_template', { payload }, 'pos_menu_item', 'bar-pack');
        }
        throw rpcError;
      }
    }
    return queueOfflineRpcMutation('set_bar_pos_pack_template', { payload }, 'pos_menu_item', 'bar-pack');
  });

  function queueOfflineRpcMutation(functionName, rpcArgs, entityType, entityId, { dependsOn = null, localPatch = null, cacheName = null } = {}) {
    const queueItem = createQueueItem({ functionName, payload: rpcArgs, entityType, entityId, dependsOn });
    enqueueLegacyQueueItem(queueItem);
    if (cacheName && localPatch) {
      const cached = readCache(cacheName);
      if (localPatch._insert) {
        cached.unshift(localPatch);
      } else if (localPatch._updateKey) {
        const idx = cached.findIndex((c) => c.id === localPatch._updateKey);
        if (idx >= 0) cached[idx] = { ...cached[idx], ...localPatch };
      }
      writeCache(cacheName, cached);
    }
    return { success: true, offline: true };
  }

  // ── Orders (with automatic offline queue on network error) ─────────────────
  ipcMain.handle('pos:create-order', async (_event, data) => {
    const lodgeId = requireLodgeContext();
    if (!data.shift_id) throw new Error('Open a shift before creating an order.');
    if (!(data.items || []).every((item) => normalizeUuid(item?.menu_item_id))) {
      throw new Error('Every sold item must be linked to a published POS menu item. Refresh or link inventory before selling it.');
    }
    const catalog = state.isOnline
      ? await getActiveLegacyCatalog(data.outlet_id || null)
      : getCachedLegacyCatalog(data.outlet_id || null);
    if (!catalog?.snapshot_id) {
      throw new Error('No catalog snapshot is available for this outlet. Connect and publish the catalog first.');
    }
    const payload = buildCreatePosOrderPayloadV3({
      ...data,
      lodge_id: lodgeId,
      catalog_snapshot_id: catalog.snapshot_id,
      source_device_id: getLegacyPosDeviceId(),
      cashier_id: data.cashier_id || state.currentUser?.id,
      cashier_name: data.cashier_name || state.currentUser?.name
    });
    validateProviderPaymentReferences(payload.payment_breakdown, payload.payment_method);
    const estimates = buildPosTotals(data.items || [], data);

    // Offline folio guard: require the cached room or event target to be
    // explicit. The server will revalidate it when the queued RPC replays.
    if (payload.payment_method === 'folio' && !payload.booking_id && !payload.event_booking_id && !state.isOnline) {
      throw new Error('Folio charge requires an active room booking or event cached locally.');
    }

    const queueProvisionalOrder = () => {
      const pendingShift = readCache('pos-shifts').find((shift) =>
        shift.id === payload.shift_id && shift._pending_sync
      );
      const queueItem = createQueueItem({
        functionName: 'create_pos_order_v3',
        payload: { payload },
        entityType: 'pos_order',
        entityId: payload.id,
        dependsOn: pendingShift ? `pos_shift_open-${payload.shift_id}` : null
      });
      enqueueLegacyQueueItem(queueItem);

      const orderRow = {
        ...payload,
        total: estimates.total,
        gross_total: estimates.gross_total,
        discount_total: estimates.discount_total,
        tax_rate: estimates.tax_rate,
        tax_total: estimates.tax_total,
        tip_total: estimates.tip_total,
        status: 'pending',
        created_at: payload.client_created_at,
        _pending_sync: true,
        _sync_state: 'pending',
        _idempotency_key: payload.create_idempotency_key,
        _sync_created_offline: true,
        pos_order_items: (data.items || []).map((item) => ({
          id: randomUUID(), order_id: payload.id, lodge_id: lodgeId, ...item,
          // Quantity × unit price is only a local pricing estimate. Keep the
          // provisional row visibly unposted until the authoritative RPC
          // records the line amount.
          subtotal: item.subtotal ?? item.net_subtotal ?? item.gross_subtotal ?? null
        }))
      };
      const cachedOrders = readCache('pos-orders');
      cachedOrders.unshift(orderRow);
      writeCache('pos-orders', cachedOrders);
      applyOfflinePosInventoryReservation(data.items || []);
      appendPrepTickets(orderRow, orderRow.pos_order_items);
      return { success: true, id: payload.id, offline: true, provisional: true };
    };

    if (!state.isOnline || !state.supabase) {
      return queueProvisionalOrder();
    }

    // Online path
    try {
      const { data: result, error } = await state.supabase.rpc('create_pos_order_v3', { payload });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Order failed');
      appendPrepTickets({ id: result.id || payload.id, ...payload }, result.items || data.items || []);
      await refreshRemoteOrders();
      return result;
    } catch (rpcError) {
      // Network error → queue automatically with same payload
      if (isNetworkError(rpcError)) {
        return { ...queueProvisionalOrder(), queued: true };
      }
      // Business error → do not queue, propagate
      throw rpcError;
    }
  });

  ipcMain.handle('pos:get-orders', async (_event, { startDate, endDate } = {}) => {
    const outletFilter = getUserOutletFilter();
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const lodgeId = requireLodgeContext();
      let query = state.supabase.from('pos_orders')
        .select('id, room_id, booking_id, walk_in_name, total, gross_total, discount_total, tax_rate, tax_total, tip_total, notes, payment_method, payment_breakdown, outlet_id, service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name, shift_id, ticket_status, status, created_at, pos_order_items(*), outlets(name)')
        .eq('lodge_id', lodgeId);
      if (startDate) query = query.gte('created_at', startDate);
      if (endDate) query = query.lte('created_at', endDate + 'T23:59:59.999Z');
      const { data, error } = await query.order('created_at', { ascending: false }).limit(state.lowResource.ordersLimit);
      if (error) throw new Error(error.message);
      const merged = mergeOrders(data || [], readCache('pos-orders'));
      writeCache('pos-orders', merged);
      return applyOutletFilter(merged, outletFilter).map((order) => ({
        ...order,
        _financial_complete: ['completed', 'settled'].includes(String(order?.status || '').toLowerCase())
          && Number.isFinite(Number(order?.total))
          && hasRecordedPosTenderEnvelope(order)
      }));
    }
    return applyOutletFilter(readCache('pos-orders'), outletFilter).map((order) => ({ ...order, _financial_complete: false }));
  });

  ipcMain.handle('pos:void-order', async (_event, payload) => {
    const lodgeId = requireLodgeContext();
    const voidPayload = buildVoidPayload({
      ...payload,
      lodge_id: lodgeId,
      device_id: getLegacyPosDeviceId()
    });

    // Online path
    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('approve_pos_void_with_pin', { payload: voidPayload });
        if (error) throw new Error(error.message);
        if (!result?.success) throw new Error(result?.error || 'Void failed');
        await refreshRemoteOrders();
        return result;
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          return queueOfflineVoid(voidPayload, lodgeId);
        }
        throw rpcError;
      }
    }
    // Offline path
    return queueOfflineVoid(voidPayload, lodgeId);
  });

  function queueOfflineVoid(voidPayload, lodgeId) {
    const cachedOrders = readCache('pos-orders');
    const cachedOrder = cachedOrders.find((o) => o.id === voidPayload.order_id);
    if (!cachedOrder) throw new Error('Order not found in local cache. Go online to void remote orders.');

    const isOrderPending = cachedOrder._pending_sync || cachedOrder._sync_created_offline;
    const queueItem = createQueueItem({
      functionName: 'approve_pos_void_with_pin',
      payload: { payload: voidPayload },
      entityType: 'pos_void',
      entityId: voidPayload.order_id,
      dependsOn: isOrderPending ? `pos_order-${voidPayload.order_id}` : null
    });
    enqueueLegacyQueueItem(queueItem);

    patchLocalOrderState(voidPayload.order_id, {
      _pending_sync: true,
      _sync_state: 'pending',
      _pending_void: true,
      _void_reason: voidPayload.reason
    });

    return { success: true, offline: true, provisional: true, override_log_id: voidPayload.override_log_id };
  }

  ipcMain.handle('pos:partial-return', async (_event, payload) => {
    const lodgeId = requireLodgeContext();
    const { order_id, pin, reason, lines, outlet_id, shift_id } = payload || {};
    if (!order_id || !pin || !shift_id || !String(reason || '').trim() || !Array.isArray(lines) || lines.length === 0) {
      throw new Error('Order, open shift, PIN, reason, and at least one line are required for partial return.');
    }

    const cachedOrders = readCache('pos-orders');
    const parentOrder = cachedOrders.find((o) => o.id === order_id);
    if (!parentOrder) throw new Error('Parent order not found in local cache.');

    const isParentPending = parentOrder._pending_sync || parentOrder._sync_created_offline;
    const returnId = randomUUID();
    const returnIdempotencyKey = `pos-return:${returnId}`;

    for (const line of lines) {
      const parentItem = (parentOrder.pos_order_items || []).find((item) => item.id === (line.line_id || line.id));
      const quantity = Number(line.quantity || 0);
      if (!parentItem || !Number.isInteger(quantity) || quantity <= 0 || quantity > Number(parentItem.quantity || 0)) {
        throw new Error('Return quantities must be positive whole numbers and cannot exceed the sold quantity.');
      }
    }

    const rpcPayload = buildReturnPayloadV3({
      order_id,
      lodge_id: lodgeId,
      return_order_id: returnId,
      shift_id,
      return_idempotency_key: returnIdempotencyKey,
      pin,
      device_id: getLegacyPosDeviceId(),
      reason,
      outlet_id: outlet_id || parentOrder.outlet_id || null,
      override_log_id: randomUUID(),
      lines
    });

    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('create_pos_return_v3', { payload: rpcPayload });
        if (error) throw new Error(error.message);
        if (!result?.success) throw new Error(result?.error || 'Return failed');
        await refreshRemoteOrders();
        return { success: true, id: result.id || returnId };
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          return queueOfflineReturn(rpcPayload, lines, lodgeId, order_id, isParentPending, parentOrder);
        }
        throw rpcError;
      }
    }
    return queueOfflineReturn(rpcPayload, lines, lodgeId, order_id, isParentPending, parentOrder);
  });

  function queueOfflineReturn(rpcPayload, lines, lodgeId, parentOrderId, isParentPending, parentOrder) {
    const returnId = rpcPayload.return_order_id;
    const queueItem = createQueueItem({
      functionName: 'create_pos_return_v3',
      payload: { payload: rpcPayload },
      entityType: 'pos_return',
      entityId: returnId,
      dependsOn: isParentPending ? `pos_order-${parentOrderId}` : null
    });
    enqueueLegacyQueueItem(queueItem);

    const returnItems = lines.map((line) => {
      const parentItem = (parentOrder.pos_order_items || []).find((pi) => pi.id === line.line_id || pi.menu_item_id === line.menu_item_id);
      if (!parentItem) return null;
      const qty = Math.abs(Number(line.quantity) || 0);
      if (qty <= 0) return null;
      return {
        menu_item_id: parentItem.menu_item_id || null,
        inventory_item_id: parentItem.inventory_item_id || null,
        depletion_qty: parentItem.depletion_qty || 1,
        item_name: `Return: ${parentItem.item_name}`,
        quantity: -qty,
        unit_price: Math.abs(Number(parentItem.unit_price) || 0),
        category: parentItem.category || null,
        modifiers: parentItem.modifiers || [],
        item_notes: `Return for ${parentItem.item_name} (order ${parentOrderId})`
      };
    }).filter(Boolean);

    const returnTotal = normalizeMoney(returnItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0));
    const returnItemsCached = returnItems.map((item) => ({
      id: randomUUID(), order_id: returnId, lodge_id: lodgeId, ...item,
      subtotal: Number(item.quantity || 0) * Number(item.unit_price || 0)
    }));
    const returnRow = {
      id: returnId,
      lodge_id: lodgeId,
      order_id: parentOrderId,
      items: returnItems,
      total: returnTotal,
      gross_total: returnTotal,
      // The return is provisional until the authoritative RPC records its
      // reversal and tender. Never inherit the original sale's tender here.
      payment_method: null,
      outlet_id: rpcPayload.outlet_id,
      walk_in_name: `Return: ${parentOrder.walk_in_name || 'Guest'}`,
      room_id: parentOrder.room_id || null,
      booking_id: parentOrder.booking_id || null,
      notes: rpcPayload.reason,
      cashier_id: state.currentUser?.id || null,
      cashier_name: state.currentUser?.name || null,
      shift_id: rpcPayload.shift_id,
      status: 'pending',
      created_at: new Date().toISOString(),
      _pending_sync: true,
      _sync_state: 'pending',
      _pending_return: true,
      _idempotency_key: rpcPayload.return_idempotency_key,
      _sync_created_offline: true,
      pos_order_items: returnItemsCached
    };
    const cachedOrders = readCache('pos-orders');
    cachedOrders.unshift(returnRow);
    writeCache('pos-orders', cachedOrders);

    return { success: true, id: returnId, offline: true, provisional: true };
  }

  // ── Cash-Up ────────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-cashup-summary', async (_event, { date, outletId, openingFloat, shiftId } = {}) => {
    const lodgeId = requireLodgeContext();
    if (state.isOnline && state.supabase && shiftId) {
      const { data, error } = await state.supabase.rpc('get_pos_shift_cashup_preview_v2', {
        p_shift_id: shiftId,
        p_lodge_id: lodgeId
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Could not load shift cash-up preview.');
      return {
        ...data,
        orders_count: data.order_count || 0,
        returns_total: data.returns || 0,
        by_method: data.expected_by_method || {},
        pending_count: 0,
        source: 'server',
        // Blind operator previews intentionally omit monetary expectations.
        // Only a complete server envelope may drive displayed totals/variance.
        complete: data.expected_by_method !== undefined
          && data.gross_sales !== undefined
          && data.net_sales !== undefined,
        financial_truth: data.expected_by_method !== undefined
          && data.gross_sales !== undefined
          && data.net_sales !== undefined
          ? 'server_confirmed'
          : 'operator_blind'
      };
    }
    const outletFilter = getUserOutletFilter();
    let orders = readCache('pos-orders');
    if (date) {
      orders = orders.filter((o) => {
        const created = String(o.created_at || '').slice(0, 10);
        return created === date;
      });
    }
    if (outletId) {
      orders = orders.filter((o) => !o.outlet_id || o.outlet_id === outletId);
    }
    if (outletFilter !== null && Array.isArray(outletFilter)) {
      orders = orders.filter((o) => !o.outlet_id || outletFilter.includes(o.outlet_id));
    }
    return summarizeCashupOrders(orders, { openingFloat: Number(openingFloat) || 0 });
  });

  ipcMain.handle('pos:create-cashup', async (_event, payload) => {
    const lodgeId = requireLodgeContext();
    if (!payload.shift_id) throw new Error('An open shift is required for cash-up.');
    const role = String(state.currentUser?.role || '').toLowerCase();
    if (!['supervisor', 'manager', 'admin', 'super_admin', 'administrator', 'superadmin'].includes(role)) {
      throw new Error('A supervisor or manager must finalize the cash-up.');
    }
    if (!state.isOnline || !state.supabase) {
      throw new Error('Cash-up finalization requires an internet connection. Keep the shift open and sync all sales first.');
    }
    const unresolvedFinancialItems = readSyncQueue().filter((item) =>
      isFinancialQueueItem(item) && item.status !== 'synced'
    );
    if (unresolvedFinancialItems.length > 0) {
      throw new Error(`Sync or resolve ${unresolvedFinancialItems.length} financial queue item(s) before finalizing the cash-up.`);
    }
    const outletFilter = getUserOutletFilter();
    const date = payload.date || new Date().toISOString().slice(0, 10);

    let orders = readCache('pos-orders').filter((o) => {
      const created = String(o.created_at || '').slice(0, 10);
      return created === date;
    });
    if (outletFilter !== null && Array.isArray(outletFilter)) {
      orders = orders.filter((o) => !o.outlet_id || outletFilter.includes(o.outlet_id));
    }
    if (payload.outlet_id) {
      orders = orders.filter((o) => !o.outlet_id || o.outlet_id === payload.outlet_id);
    }

    const computed = summarizeCashupOrders(orders, { openingFloat: Number(payload.opening_float) || 0 });
    const openingFloat = Number(payload.opening_float) || 0;
    const countedByMethod = payload.counted_by_method || {};
    const expectedCashDrawer = computed.expected_cash_drawer;
    const { countedCash, cashOverShort, varianceByMethod } = computeCashupVariances(
      computed.by_method,
      countedByMethod,
      expectedCashDrawer
    );

    const cashupPayload = buildFinalizeCashupPayloadV2({
      cashup_id: payload.id || randomUUID(),
      lodge_id: lodgeId,
      shift_id: payload.shift_id,
      counted_by_method: countedByMethod,
      notes: payload.notes || null
    });
    const localCashup = {
      id: cashupPayload.cashup_id,
      lodge_id: lodgeId,
      shift_id: payload.shift_id,
      date,
      outlet_id: payload.outlet_id || null,
      opening_float: openingFloat,
      expected_cash_drawer: expectedCashDrawer,
      expected_by_method: computed.by_method,
      counted_by_method: countedByMethod,
      variance_by_method: varianceByMethod,
      cash_over_short: cashOverShort,
      orders_count: computed.orders_count,
      void_count: computed.void_count,
      pending_count: computed.pending_count,
      gross_sales: computed.gross_sales,
      returns_total: computed.returns_total,
      net_sales: computed.net_sales,
      notes: payload.notes || null,
      created_by: state.currentUser?.id,
      created_by_name: state.currentUser?.name,
      cashier_id: payload.cashier_id || state.currentUser?.id,
      cashier_name: payload.cashier_name || state.currentUser?.name,
      created_at: new Date().toISOString()
    };

    try {
      const { data: result, error } = await state.supabase.rpc('finalize_pos_shift_cashup_v2', { payload: cashupPayload });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Cash-up failed');
      const cashups = readCache('pos-cashups');
      cashups.unshift({
        ...localCashup,
        id: result.cashup_id || cashupPayload.cashup_id,
        expected_cash_drawer: Number(result.expected_cash_drawer || 0),
        expected_by_method: result.expected_by_method || {},
        counted_by_method: result.counted_by_method || countedByMethod,
        variance_by_method: result.variance_by_method || {},
        source: 'server',
        complete: true,
        financial_truth: 'server_confirmed',
        _pending_sync: false,
        _sync_state: 'synced'
      });
      writeCache('pos-cashups', cashups);
      await refreshRemoteOrders();
      return result;
    } catch (rpcError) {
      if (isNetworkError(rpcError)) {
        throw new Error('Connection was lost before the cash-up was confirmed. The shift remains open; reconnect, sync, and try again.');
      }
      throw rpcError;
    }
  });

  ipcMain.handle('pos:get-cashups', async (_event, { limit = 30 } = {}) => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      try {
        const { data, error } = await state.supabase.from('pos_cashup_sessions')
          .select('*, outlets(name)').eq('lodge_id', requireLodgeContext())
          .order('created_at', { ascending: false }).limit(limit);
        if (error) throw error;
        const rows = (data || []).map((r) => ({ ...r, outlet_name: r.outlets?.name || null, source: 'server', complete: true, financial_truth: 'server_confirmed' }));
        if (rows.length > 0) writeCache('pos-cashups', rows);
        return rows.length > 0 ? rows : readCache('pos-cashups').slice(0, limit).map((r) => ({ ...r, source: 'cache', complete: false, financial_truth: 'cache_estimate' }));
      } catch { return readCache('pos-cashups').slice(0, limit).map((r) => ({ ...r, source: 'cache', complete: false, financial_truth: 'cache_estimate' })); }
    }
    return readCache('pos-cashups').slice(0, limit).map((r) => ({ ...r, source: 'cache', complete: false, financial_truth: 'cache_estimate' }));
  });

  // ── Outlets ────────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-outlets', async () => {
    const activeLodgeId = hasLodgeContext() ? requireLodgeContext() : null;
    const normalizeOutletRows = (rows = []) => (rows || [])
      .filter(Boolean)
      .filter((row) => row.is_active !== false)
      .map((row, i) => ({
        ...row,
        id: row.id || null,
        lodge_id: normalizeUuid(row.lodge_id) || activeLodgeId,
        name: row.name || `Outlet ${i + 1}`,
        type: row.type || 'accommodation',
        sort_order: Number(row.sort_order ?? i)
      }))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const buildVirtualOutlets = () => [
      { id: null, lodge_id: activeLodgeId, name: 'Kitchen', type: 'food', sort_order: 1, _virtual: true },
      { id: null, lodge_id: activeLodgeId, name: 'Bar', type: 'beverage', sort_order: 2, _virtual: true },
      { id: null, lodge_id: activeLodgeId, name: 'Others', type: 'accommodation', sort_order: 3, _virtual: true }
    ];
    if (state.isOnline && state.supabase && activeLodgeId) {
      const lodgeId = activeLodgeId;
      try {
        let { data, error } = await state.supabase.from('outlets')
          .select('id, lodge_id, name, type, sort_order').eq('lodge_id', lodgeId).eq('is_active', true).order('sort_order');
        if (error) {
          const fallback = await state.supabase.from('outlets')
            .select('id, lodge_id, name, type, sort_order, is_active').eq('lodge_id', lodgeId).order('sort_order');
          data = fallback.data;
          error = fallback.error;
        }
        if (error) throw error;
        const normalized = normalizeOutletRows(data || []);
        if (normalized.length > 0) writeCache('outlets', normalized);
        const cached = readArrayCacheForCurrentLodge('outlets');
        if (normalized.length > 0) return normalized;
        if (cached.length > 0) return cached;
        const virtual = buildVirtualOutlets();
        writeCache('outlets', virtual);
        return virtual;
      } catch {
        const cached = readArrayCacheForCurrentLodge('outlets');
        return cached.length > 0 ? cached : buildVirtualOutlets();
      }
    }
    const cached = readArrayCacheForCurrentLodge('outlets');
    return cached.length > 0 ? cached : buildVirtualOutlets();
  });

  // ── Staff ──────────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-staff', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const lodgeId = requireLodgeContext();
      const { data, error } = await state.supabase.rpc('pos_get_safe_staff', {
        p_lodge_id: lodgeId
      });
      if (error) throw new Error(error.message);
      const safe = Array.isArray(data) ? data : [];
      writeCache('pos-staff', safe);
      return safe;
    }
    const cached = readCache('pos-staff');
    return Array.isArray(cached) ? cached : [];
  });

  ipcMain.handle('pos:get-approver-candidates', async () => {
    const cachedCandidates = () => (Array.isArray(readCache('pos-staff')) ? readCache('pos-staff') : [])
      .filter((u) => u?.has_pin)
      .filter((u) => ['supervisor', 'manager', 'admin', 'super_admin'].includes(String(u.role || '').toLowerCase()));
    if (!state.isOnline || !hasLodgeContext()) return cachedCandidates();
    const { data, error } = await state.supabase.rpc('pos_get_safe_staff', {
      p_lodge_id: requireLodgeContext()
    });
    if (error) return cachedCandidates();
    const rows = Array.isArray(data) ? data : [];
    writeCache('pos-staff', rows);
    return rows
      .filter((u) => u?.has_pin)
      .filter((u) => ['supervisor', 'manager', 'admin', 'super_admin'].includes(String(u.role || '').toLowerCase()));
  });

  // ── Inventory ──────────────────────────────────────────────────────────────
  const INVENTORY_ITEM_SELECT = 'id, name, category, unit, current_stock, reorder_level, selling_price, outlet_id, latest_unit_cost, lodge_id, created_at, updated_at, sku, barcode, is_active';
  const INVENTORY_ITEM_LEGACY_SELECT = 'id, name, category, unit, current_stock, selling_price, outlet_id, latest_unit_cost, lodge_id, created_at';

  ipcMain.handle('pos:get-inventory', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const lodgeId = requireLodgeContext();
      let { data, error } = await state.supabase.from('inventory_items')
        .select(INVENTORY_ITEM_SELECT).eq('lodge_id', lodgeId);
      if (error && isMissingInventoryCompatibilityColumnError(error)) {
        ({ data, error } = await state.supabase.from('inventory_items')
          .select(INVENTORY_ITEM_LEGACY_SELECT).eq('lodge_id', lodgeId));
      }
      if (error) throw new Error(error.message);
      if (data && data.length > 0) {
        const rows = (data || []).map((item) => ({
          ...item,
          unit_cost: item.latest_unit_cost || 0,
          sku: item.sku || null,
          barcode: item.barcode || null,
          is_active: item.is_active !== false,
          updated_at: item.updated_at || null
        }));
        writeCache('inventory-items', rows);
        return rows;
      }
      const cached = readInventoryCache();
      if (cached && cached.length > 0) return cached;
      return [];
    }
    return readInventoryCache();
  });

  // ── Rooms & Bookings ──────────────────────────────────────────────────────
  ipcMain.handle('pos:get-rooms', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const lodgeId = requireLodgeContext();
      const { data, error } = await state.supabase.from('rooms')
        .select('id, room_number, room_type, status').eq('lodge_id', lodgeId).order('room_number').limit(200);
      if (error) throw new Error(error.message);
      const rows = (data || []).map((room) => ({
        ...room,
        name: room.room_number,
        number: room.room_number
      }));
      writeCache('rooms', rows);
      return rows;
    }
    return readCache('rooms');
  });

  ipcMain.handle('pos:get-bookings', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const lodgeId = requireLodgeContext();
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await state.supabase.from('bookings')
        .select('id, room_id, customer_id, status, check_in, check_out, customers(name), rooms(room_number)')
        .eq('lodge_id', lodgeId).in('status', ['confirmed', 'checked_in'])
        .lte('check_in', today).gt('check_out', today);
      if (error) throw new Error(error.message);
      const rows = (data || []).map((booking) => ({
        ...booking,
        guest_name: booking.customers?.name || 'Guest',
        customer_name: booking.customers?.name || 'Guest',
        room_number: booking.rooms?.room_number || null
      }));
      writeCache('bookings', rows);
      return rows;
    }
    return readCache('bookings');
  });

  ipcMain.handle('pos:get-events', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const lodgeId = requireLodgeContext();
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await state.supabase.from('conference_bookings')
        .select('id, event_name, event_type, booking_date, start_time, end_time, status, client_name, balance_due')
        .eq('lodge_id', lodgeId)
        .in('status', ['reserved', 'confirmed', 'active'])
        .gte('booking_date', today)
        .order('booking_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(state.lowResource.ordersLimit);
      if (error) throw new Error(error.message);
      const rows = data || [];
      writeCache('event-bookings', rows);
      return rows;
    }
    return readCache('event-bookings');
  });

  // ── Tables & Tabs ──────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-tables', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.from('pos_tables').select('*').eq('lodge_id', requireLodgeContext());
      if (!error && data) writeCache('pos-tables', data);
      return data || readCache('pos-tables');
    }
    return readCache('pos-tables');
  });

  ipcMain.handle('pos:save-table', async (_event, table) => {
    const lodgeId = requireLodgeContext();
    const payload = { ...table, lodge_id: lodgeId };
    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('upsert_pos_table', { payload });
        if (error) throw new Error(error.message);
        if (result) {
          const tables = readCache('pos-tables');
          const idx = tables.findIndex((t) => t.id === payload.id);
          if (idx >= 0) tables[idx] = { ...tables[idx], ...payload };
          else tables.push(payload);
          writeCache('pos-tables', tables);
        }
        return result;
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          return queueOfflineRpcMutation('upsert_pos_table', { payload }, 'pos_table', payload.id || randomUUID(), {
            cacheName: 'pos-tables',
            localPatch: { id: payload.id, ...payload, _pending_sync: true, _sync_state: 'pending', _updateKey: payload.id, _insert: true }
          });
        }
        throw rpcError;
      }
    }
    return queueOfflineRpcMutation('upsert_pos_table', { payload }, 'pos_table', payload.id || randomUUID(), {
      cacheName: 'pos-tables',
      localPatch: { id: payload.id, ...payload, _pending_sync: true, _sync_state: 'pending', _updateKey: payload.id, _insert: true }
    });
  });

  ipcMain.handle('pos:get-tabs', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.from('pos_tabs').select('*').eq('lodge_id', requireLodgeContext());
      if (!error && data) writeCache('pos-tabs', data);
      return data || readCache('pos-tabs');
    }
    return readCache('pos-tabs');
  });

  ipcMain.handle('pos:save-tab', async (_event, tab) => {
    const lodgeId = requireLodgeContext();
    const payload = { ...tab, lodge_id: lodgeId };
    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('upsert_pos_tab', { payload });
        if (error) throw new Error(error.message);
        if (result) {
          const tabs = readCache('pos-tabs');
          const idx = tabs.findIndex((t) => t.id === payload.id);
          if (idx >= 0) tabs[idx] = { ...tabs[idx], ...payload };
          else tabs.push(payload);
          writeCache('pos-tabs', tabs);
        }
        return result;
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          return queueOfflineRpcMutation('upsert_pos_tab', { payload }, 'pos_tab', payload.id || randomUUID(), {
            cacheName: 'pos-tabs',
            localPatch: { id: payload.id, ...payload, _pending_sync: true, _sync_state: 'pending', _updateKey: payload.id, _insert: true }
          });
        }
        throw rpcError;
      }
    }
    return queueOfflineRpcMutation('upsert_pos_tab', { payload }, 'pos_tab', payload.id || randomUUID(), {
      cacheName: 'pos-tabs',
      localPatch: { id: payload.id, ...payload, _pending_sync: true, _sync_state: 'pending', _updateKey: payload.id, _insert: true }
    });
  });

  ipcMain.handle('pos:update-tab-status', async (_event, { tabId, status }) => {
    const rpcArgs = { p_tab_id: tabId, p_status: status };
    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('update_pos_tab_status', rpcArgs);
        if (error) throw new Error(error.message);
        return result;
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          return queueOfflineRpcMutation('update_pos_tab_status', rpcArgs, 'pos_tab', tabId, {
            cacheName: 'pos-tabs',
            localPatch: { id: tabId, status, _pending_sync: true, _sync_state: 'pending', _updateKey: tabId }
          });
        }
        throw rpcError;
      }
    }
    return queueOfflineRpcMutation('update_pos_tab_status', rpcArgs, 'pos_tab', tabId, {
      cacheName: 'pos-tabs',
      localPatch: { id: tabId, status, _pending_sync: true, _sync_state: 'pending', _updateKey: tabId }
    });
  });

  // ── Prep Tickets (RPC-based status update) ────────────────────────────────
  ipcMain.handle('pos:get-tickets', async (_event, { station } = {}) => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.from('pos_prep_tickets')
        .select('*, outlets(name, type)').eq('lodge_id', requireLodgeContext()).order('created_at', { ascending: false }).limit(state.lowResource.ticketsLimit);
      const normalized = (data || []).map((t) => ({
        ...t,
        outlet_name: t.outlets?.name || t.outlet_name || null,
        outlet_type: t.outlets?.type || t.outlet_type || null
      }));
      if (!error && data) writeCache('pos-tickets', normalized);
      const tickets = normalized.length ? normalized : readCache('pos-tickets');
      if (station && station !== 'all') {
        return tickets.filter((t) => {
          const ticketStation = String(t.station || '').toLowerCase();
          if (ticketStation === station) return true;
          const outlet = String(t.outlet_name || '').toLowerCase();
          const type = String(t.outlet_type || '').toLowerCase();
          return station === 'bar'
            ? ticketStation.includes('bar') || outlet.includes('bar') || type.includes('beverage')
            : ticketStation.includes('kitchen') || outlet.includes('kitchen') || outlet.includes('food') || type.includes('food');
        });
      }
      return tickets;
    }
    return readCache('pos-tickets');
  });

  ipcMain.handle('pos:update-ticket-status', async (_event, { ticketId, status }) => {
    const lodgeId = requireLodgeContext();
    // RPC path (online): single source of truth for status transition
    if (state.isOnline && state.supabase) {
      const { data: result, error } = await state.supabase.rpc('update_pos_prep_ticket_status', {
        p_ticket_id: ticketId,
        p_status: status,
        p_lodge_id: lodgeId
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not update ticket status');
    } else {
      const queue = readSyncQueue();
      queue.push(createQueueItem({
        functionName: 'update_pos_prep_ticket_status',
        payload: { p_ticket_id: ticketId, p_status: status, p_lodge_id: lodgeId },
        entityType: 'pos_ticket',
        entityId: ticketId
      }));
      writeSyncQueue(queue);
    }
    // Always update local cache (online or offline)
    const tickets = readCache('pos-tickets');
    const idx = tickets.findIndex((t) => t.id === ticketId);
    if (idx >= 0) {
      tickets[idx] = { ...tickets[idx], status, _pending_sync: !state.isOnline };
      writeCache('pos-tickets', tickets);
    }
  });

  // ── Hardware ───────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-hardware-settings', () => {
    const rows = readCache('pos-hardware-settings');
    return Array.isArray(rows) && rows[0] ? rows[0] : normalizePosHardwareSettings({});
  });

  ipcMain.handle('pos:save-hardware-settings', (_event, settings) => {
    const normalized = normalizePosHardwareSettings(settings);
    writeCache('pos-hardware-settings', [normalized]);
    return normalized;
  });

  ipcMain.handle('pos:print-receipt', async (_event, { order, business, settings, openDrawer }) => {
    const normalized = normalizePosHardwareSettings(settings || readCache('pos-hardware-settings')?.[0] || {});
    if (order && !order.receipt_number && order._pending_sync !== true) {
      return { success: false, error: 'Printing is blocked until the server-issued receipt number is available.' };
    }
    if (normalized.receipt_print_mode === 'escpos') {
      return printEscPosReceipt({ order: order || {}, business: business || {}, settings: normalized, openDrawer: !!openDrawer });
    }
    return { success: true, message: 'Windows printer mode - use browser print.' };
  });

  ipcMain.handle('pos:open-cash-drawer', async (_event, settings) => {
    const normalized = normalizePosHardwareSettings(settings || readCache('pos-hardware-settings')?.[0] || {});
    return openCashDrawerHardware(normalized);
  });

  ipcMain.handle('pos:test-hardware', async (_event, { kind, settings, business }) => {
    return testPosHardwareDevice(kind, settings || {}, business || {});
  });

  ipcMain.handle('pos:send-payment-terminal-total', async (_event, data = {}) => {
    const normalized = normalizePosHardwareSettings(data.settings || readCache('pos-hardware-settings')?.[0] || {});
    return sendPaymentTerminalTotal(normalized, data);
  });

  ipcMain.handle('pos:get-receipt-printers', () => ['Default', 'POS58', 'POS80', 'TM-T20II', 'TM-T88VI']);
  ipcMain.handle('pos:get-displays', () => []);

  // ── Displays ───────────────────────────────────────────────────────────────
  ipcMain.handle('pos:open-customer-display', () => { createDisplayWindow('customer', 'Customer Display'); return true; });
  ipcMain.handle('pos:close-customer-display', () => { if (customerDisplayWindow) { customerDisplayWindow.close(); customerDisplayWindow = null; } return true; });
  ipcMain.handle('pos:update-customer-display', (_event, snapshot) => {
    writeCache('pos-customer-display', { ...snapshot, updated_at: new Date().toISOString() });
    if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) customerDisplayWindow.webContents.send('display:update', snapshot);
    return true;
  });
  ipcMain.handle('pos:get-customer-display', () => { const r = readCache('pos-customer-display'); return r && typeof r === 'object' ? r : null; });
  ipcMain.handle('pos:open-kitchen-display', () => { createDisplayWindow('kitchen', 'Kitchen Display'); return true; });
  ipcMain.handle('pos:close-kitchen-display', () => { if (kitchenDisplayWindow) { kitchenDisplayWindow.close(); kitchenDisplayWindow = null; } return true; });
  ipcMain.handle('pos:open-external-display', (_event, { type }) => { createDisplayWindow(type, type === 'customer' ? 'Customer Display' : 'Kitchen Display'); return true; });

  // ── Shifts (RPC-backed, database is source of truth) ───────────────────────
  ipcMain.handle('pos:get-shifts', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.rpc('get_pos_shifts', { p_lodge_id: requireLodgeContext() });
      if (error) throw new Error(error.message);
      const shifts = Array.isArray(data) ? data : [];
      if (shifts.length > 0) writeCache('pos-shifts', shifts);
      return shifts.length > 0 ? shifts : readCache('pos-shifts');
    }
    return readCache('pos-shifts');
  });

  ipcMain.handle('pos:open-shift', async (_event, data) => {
    const lodgeId = requireLodgeContext();
    const outletId = normalizeUuid(data?.outlet_id);
    if (!outletId) throw new Error('Select an outlet before opening a shift.');
    const shiftId = data.shift_id || randomUUID();
    const idempotencyKey = `pos-shift-open:${shiftId}`;
    const rpcPayload = {
      shift_id: shiftId,
      lodge_id: lodgeId,
      outlet_id: outletId,
      cashier_id: state.currentUser?.id,
      cashier_name: state.currentUser?.name || state.currentUser?.email,
      opening_float: Number(data.opening_float) || 0,
      notes: data.notes || null,
      create_idempotency_key: idempotencyKey
    };

    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('open_pos_shift_with_id', { payload: rpcPayload });
        if (error) throw new Error(error.message);
        if (!result?.success) throw new Error(result?.error || 'Could not open shift');
        const shifts = readCache('pos-shifts');
        shifts.unshift(result.shift || { id: shiftId, ...rpcPayload, status: 'open', opened_at: new Date().toISOString() });
        writeCache('pos-shifts', shifts);
        return result.shift || result;
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          return queueOfflineShiftMutation('open_pos_shift_with_id', rpcPayload, shiftId, 'open', data);
        }
        throw rpcError;
      }
    }
    return queueOfflineShiftMutation('open_pos_shift_with_id', rpcPayload, shiftId, 'open', data);
  });

  ipcMain.handle('pos:close-shift', async (_event, { shiftId, closing_cash, notes }) => {
    void shiftId;
    void closing_cash;
    void notes;
    throw new Error('Shifts can only be closed by completing the server-authoritative Cash-Up.');
  });

  function queueOfflineShiftMutation(functionName, payload, shiftId, status, data) {
    const queueItem = createQueueItem({
      functionName,
      payload: { payload },
      entityType: status === 'open' ? 'pos_shift_open' : 'pos_shift_close',
      entityId: shiftId,
      dependsOn: status === 'closed' ? `pos_shift_open-${shiftId}` : null
    });
    enqueueLegacyQueueItem(queueItem);
    const shifts = readCache('pos-shifts');
    if (status === 'closed') {
      const idx = shifts.findIndex((s) => s.id === shiftId);
      if (idx >= 0) {
        shifts[idx] = {
          ...shifts[idx],
          closing_cash: payload.closing_cash,
          notes: payload.notes || shifts[idx].notes,
          _pending_close: true,
          _pending_sync: true,
          _sync_state: 'pending'
        };
        writeCache('pos-shifts', shifts);
        return { success: true, offline: true, id: shiftId };
      }
    }
    shifts.unshift({
      id: shiftId,
      lodge_id: payload.lodge_id,
      cashier_id: payload.cashier_id || state.currentUser?.id,
      cashier_name: payload.cashier_name || state.currentUser?.name || state.currentUser?.email,
      opening_float: payload.opening_float,
      closing_cash: payload.closing_cash,
      status,
      opened_at: status === 'open' ? new Date().toISOString() : null,
      closed_at: status === 'closed' ? new Date().toISOString() : null,
      notes: payload.notes,
      _pending_sync: true,
      _sync_state: 'pending'
    });
    writeCache('pos-shifts', shifts);
    return { success: true, offline: true, id: shiftId };
  }

  // ── Modifier Groups / Promotions / Floor Layout ──────────────────────────
  // Online data is the shared source of truth. Offline mode uses the last cache.
  ipcMain.handle('pos:get-modifier-groups', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.from('pos_modifier_groups')
        .select('id, lodge_id, name, applies_to_categories, options, active, updated_at')
        .eq('lodge_id', requireLodgeContext()).eq('active', true).order('updated_at', { ascending: false }).limit(state.lowResource.configLimit);
      if (!error && data) {
        writeCache('pos-modifier-groups', data);
        return data;
      }
    }
    return readCache('pos-modifier-groups');
  });
  ipcMain.handle('pos:save-modifier-groups', async (_event, groups) => {
    const safeGroups = (groups || []).slice(0, 100);
    const lodgeId = requireLodgeContext();
    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('upsert_pos_modifier_groups', {
          payload: { lodge_id: lodgeId, groups: safeGroups }
        });
        if (error) throw new Error(error.message);
        if (!result?.success) throw new Error(result?.error || 'Could not save modifier groups');
        writeCache('pos-modifier-groups', safeGroups);
        await publishAllLegacyCatalogs();
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          queueOfflineRpcMutation('upsert_pos_modifier_groups', { payload: { lodge_id: lodgeId, groups: safeGroups } }, 'pos_config', 'modifier-groups', {
            cacheName: 'pos-modifier-groups',
            localPatch: { _insert: true, id: 'modifier-groups', lodge_id: lodgeId, groups: safeGroups, _pending_sync: true, _sync_state: 'pending' }
          });
        } else { throw rpcError; }
      }
    } else {
      queueOfflineRpcMutation('upsert_pos_modifier_groups', { payload: { lodge_id: lodgeId, groups: safeGroups } }, 'pos_config', 'modifier-groups', {
        cacheName: 'pos-modifier-groups',
        localPatch: { _insert: true, id: 'modifier-groups', lodge_id: lodgeId, groups: safeGroups, _pending_sync: true, _sync_state: 'pending' }
      });
    }
    writeCache('pos-modifier-groups', safeGroups);
    return true;
  });

  ipcMain.handle('pos:get-promotions', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.from('pos_promotions')
        .select('id, lodge_id, name, discount_type, discount_value, applies_to_category, active, updated_at')
        .eq('lodge_id', requireLodgeContext()).eq('active', true).order('updated_at', { ascending: false }).limit(state.lowResource.configLimit);
      if (!error && data) {
        writeCache('pos-promotions', data);
        return data;
      }
    }
    return readCache('pos-promotions');
  });
  ipcMain.handle('pos:save-promotions', async (_event, promos) => {
    const safePromos = (promos || []).slice(0, 100);
    const lodgeId = requireLodgeContext();
    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('upsert_pos_promotions', {
          payload: { lodge_id: lodgeId, promotions: safePromos }
        });
        if (error) throw new Error(error.message);
        if (!result?.success) throw new Error(result?.error || 'Could not save promotions');
        writeCache('pos-promotions', safePromos);
        await publishAllLegacyCatalogs();
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          queueOfflineRpcMutation('upsert_pos_promotions', { payload: { lodge_id: lodgeId, promotions: safePromos } }, 'pos_config', 'promotions', {
            cacheName: 'pos-promotions',
            localPatch: { _insert: true, id: 'promotions', lodge_id: lodgeId, promotions: safePromos, _pending_sync: true, _sync_state: 'pending' }
          });
        } else { throw rpcError; }
      }
    } else {
      queueOfflineRpcMutation('upsert_pos_promotions', { payload: { lodge_id: lodgeId, promotions: safePromos } }, 'pos_config', 'promotions', {
        cacheName: 'pos-promotions',
        localPatch: { _insert: true, id: 'promotions', lodge_id: lodgeId, promotions: safePromos, _pending_sync: true, _sync_state: 'pending' }
      });
    }
    writeCache('pos-promotions', safePromos);
    return true;
  });

  ipcMain.handle('pos:get-floor-layout', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.from('pos_floor_layouts')
        .select('layout, updated_at').eq('lodge_id', requireLodgeContext()).order('updated_at', { ascending: false }).limit(1);
      if (!error && data?.[0]?.layout) {
        writeCache('pos-floor-layout', data[0].layout);
        return data[0].layout;
      }
    }
    const v = readCache('pos-floor-layout');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : { areas: [] };
  });
  ipcMain.handle('pos:save-floor-layout', async (_event, layout) => {
    const safeLayout = { areas: Array.isArray(layout?.areas) ? layout.areas.slice(0, 50) : [], updated_at: new Date().toISOString() };
    const lodgeId = requireLodgeContext();
    if (state.isOnline && state.supabase) {
      try {
        const { data: result, error } = await state.supabase.rpc('upsert_pos_floor_layout', {
          payload: { lodge_id: lodgeId, layout: safeLayout }
        });
        if (error) throw new Error(error.message);
        if (!result?.success) throw new Error(result?.error || 'Could not save floor layout');
      } catch (rpcError) {
        if (isNetworkError(rpcError)) {
          queueOfflineRpcMutation('upsert_pos_floor_layout', { payload: { lodge_id: lodgeId, layout: safeLayout } }, 'pos_config', 'floor-layout', {
            cacheName: 'pos-floor-layout',
            localPatch: { _insert: true, id: 'floor-layout', lodge_id: lodgeId, layout: safeLayout, _pending_sync: true, _sync_state: 'pending' }
          });
        } else { throw rpcError; }
      }
    } else {
      queueOfflineRpcMutation('upsert_pos_floor_layout', { payload: { lodge_id: lodgeId, layout: safeLayout } }, 'pos_config', 'floor-layout', {
        cacheName: 'pos-floor-layout',
        localPatch: { _insert: true, id: 'floor-layout', lodge_id: lodgeId, layout: safeLayout, _pending_sync: true, _sync_state: 'pending' }
      });
    }
    writeCache('pos-floor-layout', safeLayout);
    return true;
  });

  // ── POS History Export ─────────────────────────────────────────────────────
  ipcMain.handle('pos:export-history', async (_event, { startDate, endDate } = {}) => {
    if (!state.isOnline || !state.supabase || !hasLodgeContext()) {
      throw new Error('History export requires an online, server-confirmed POS dataset. Cached or offline rows cannot be exported as financial truth.');
    }
    let q = state.supabase.from('pos_orders')
      .select('id, created_at, walk_in_name, total, payment_method, payment_breakdown, outlet_id, table_name, cashier_name, status, pos_order_items(item_name, quantity, unit_price)')
      .eq('lodge_id', requireLodgeContext());
    if (startDate) q = q.gte('created_at', startDate);
    if (endDate) q = q.lte('created_at', endDate + 'T23:59:59.999Z');
    const { data: orders, error } = await q.order('created_at', { ascending: false }).limit(state.lowResource.exportMaxRows);
    if (error) throw new Error(error.message);
    const rowsToExport = Array.isArray(orders) ? orders : [];
    const financialStatuses = new Set(['completed', 'settled', 'returned', 'refunded']);
    const incomplete = rowsToExport.filter((order) => {
      if (!financialStatuses.has(String(order?.status || '').toLowerCase())) return false;
      const total = Number(order?.total);
      const breakdown = Array.isArray(order?.payment_breakdown) ? order.payment_breakdown : [];
      const tenderTotal = breakdown.reduce((sum, payment) => sum + Number(payment?.amount), 0);
      return !Number.isFinite(total)
        || breakdown.length === 0
        || breakdown.some((payment) => !payment?.method || !Number.isFinite(Number(payment?.amount)))
        || Math.abs(tenderTotal - Math.abs(total)) > 0.005;
    });
    if (incomplete.length > 0) {
      throw new Error(`History export is unavailable: ${incomplete.length} financial order${incomplete.length === 1 ? '' : 's'} lack a complete recorded tender envelope.`);
    }
    const rows = [['Order ID', 'Date', 'Guest', 'Items', 'Total', 'Payment', 'Cashier', 'Status']];
    for (const o of rowsToExport) {
      const items = Array.isArray(o.pos_order_items) ? o.pos_order_items.map((i) => `${i.item_name} x${i.quantity}`).join('; ') : '';
      const breakdown = Array.isArray(o.payment_breakdown) ? o.payment_breakdown : [];
      const paymentLabel = breakdown.length === 1
        ? String(breakdown[0]?.method || 'Tender unavailable')
        : breakdown.length > 1
          ? 'Split tender'
          : 'Tender unavailable';
      rows.push([String(o.id).slice(0, 8), o.created_at || '', o.walk_in_name || '', items, Number.isFinite(Number(o.total)) ? String(o.total) : 'Amount unavailable', paymentLabel, o.cashier_name || '', o.status || '']);
    }
    return rows.map((r) => r.join(',')).join('\n');
  });

  // ── Sync ───────────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-sync-status', () => {
    const queue = readSyncQueue();
    return {
      isOnline: state.isOnline,
      syncInProgress: state.syncInProgress,
      pendingCount: queue.filter((i) => i.status === 'pending').length,
      failedCount: queue.filter((i) => i.status === 'failed' || i.status === 'manual_review_required').length,
      syncedCount: queue.filter((i) => i.status === 'synced').length,
      totalItems: queue.length
    };
  });

  ipcMain.handle('pos:get-sync-queue-detail', () => {
    const queue = readSyncQueue();
    const ENTITY_META = {
      pos_order: { isFinancial: true, displayName: 'Order', manualReviewAction: 'Retry or void locally' },
      pos_return: { isFinancial: true, displayName: 'Return', manualReviewAction: 'Retry or contact admin' },
      pos_void: { isFinancial: true, displayName: 'Void', manualReviewAction: 'Retry or contact admin' },
      pos_cashup: { isFinancial: true, displayName: 'Cash-Up', manualReviewAction: 'Retry or re-enter cash-up' },
      pos_menu_item: { isFinancial: false, displayName: 'Menu Item', manualReviewAction: 'Retry or edit menu item' },
      pos_table: { isFinancial: false, displayName: 'Table', manualReviewAction: 'Retry or edit table' },
      pos_tab: { isFinancial: false, displayName: 'Tab', manualReviewAction: 'Retry or edit tab' },
      pos_shift_open: { isFinancial: true, displayName: 'Open Shift', manualReviewAction: 'Retry or open shift online' },
      pos_shift_close: { isFinancial: true, displayName: 'Close Shift', manualReviewAction: 'Retry or close shift online' },
      pos_ticket: { isFinancial: false, displayName: 'Ticket', manualReviewAction: 'Retry or update ticket' },
      pos_config: { isFinancial: false, displayName: 'Config', manualReviewAction: 'Retry or save config online' }
    };
    return queue.map((item) => {
      const meta = ENTITY_META[item.entityType] || { isFinancial: false, displayName: item.entityType, manualReviewAction: 'Retry' };
      const dependency = item.dependsOn ? queue.find((q) => q.id === item.dependsOn) : null;
      const dependencyState = dependency ? dependency.status : null;
      return {
        id: item.id,
        entityType: item.entityType,
        functionName: item.functionName,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        attempts: item.attempts,
        lastError: item.lastError,
        dependsOn: item.dependsOn,
        isFinancial: meta.isFinancial,
        dependencyState,
        displayName: meta.displayName,
        manualReviewAction: meta.manualReviewAction,
        canRetry: item.status === 'failed' || item.status === 'manual_review_required'
      };
    });
  });

  function patchLocalCacheState(entityType, entityId, patch) {
    if (entityType === 'pos_order' || entityType === 'pos_return') {
      patchLocalOrderState(entityId, patch);
    } else if (entityType === 'pos_cashup') {
      patchLocalCashupState(entityId, patch);
    } else if (entityType === 'pos_ticket') {
      patchLocalTicketState(entityId, patch);
    } else if (entityType === 'pos_menu_item') {
      const cached = readCache('pos-menu-items');
      const idx = cached.findIndex((c) => c.id === entityId);
      if (idx >= 0) { cached[idx] = { ...cached[idx], ...patch }; writeCache('pos-menu-items', cached); }
    } else if (entityType === 'pos_table') {
      const cached = readCache('pos-tables');
      const idx = cached.findIndex((c) => c.id === entityId);
      if (idx >= 0) { cached[idx] = { ...cached[idx], ...patch }; writeCache('pos-tables', cached); }
    } else if (entityType === 'pos_tab') {
      const cached = readCache('pos-tabs');
      const idx = cached.findIndex((c) => c.id === entityId);
      if (idx >= 0) { cached[idx] = { ...cached[idx], ...patch }; writeCache('pos-tabs', cached); }
    } else if (entityType === 'pos_shift_open' || entityType === 'pos_shift_close') {
      const cached = readCache('pos-shifts');
      const idx = cached.findIndex((c) => c.id === entityId);
      if (idx >= 0) { cached[idx] = { ...cached[idx], ...patch }; writeCache('pos-shifts', cached); }
    }
  }

  ipcMain.handle('pos:sync-retry', async () => {
    if (state.syncInProgress) return { skipped: true };
    if (!state.isOnline || !state.supabase) return { skipped: true, reason: 'offline' };
    state.syncInProgress = true;
    try {
      const queue = readSyncQueue();
      let synced = 0, failed = 0;

      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (item.status !== 'pending' && item.status !== 'failed') continue;
        if (!isQueueItemReady(item, queue)) continue;

        queue[i] = markItemSyncing(item);
        journalQueueState(item, { status: 'syncing', updatedAt: queue[i].updatedAt });
        writeSyncQueue(queue);

        try {
          const replayPayload = resolveLegacyQueuePayload(item.payload);
          const authoritativeReplayPayload = item.functionName === 'create_pos_order_v3'
            ? {
                ...replayPayload,
                payload: adaptLegacyPosOrderFinancialPayload(replayPayload?.payload)
              }
            : replayPayload;
          const { data: result, error } = await state.supabase.rpc(item.functionName, authoritativeReplayPayload);
          if (error) throw new Error(error.message);
          if (result?.success === false && result?.error) throw new Error(result.error);

          queue[i] = markItemSynced(item);
          journalQueueState(item, { status: 'synced', updatedAt: queue[i].updatedAt });
          synced++;

          patchLocalCacheState(item.entityType, item.entityId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _server_id: result?.id || item.entityId,
            _synced_at: new Date().toISOString()
          });
        } catch (err) {
          if (isNetworkError(err)) {
            queue[i] = markItemFailed(item, err.message);
          } else {
            queue[i] = { ...markItemFailed(item, err.message), status: 'manual_review_required' };
          }
          journalQueueState(item, {
            status: queue[i].status,
            attempts: queue[i].attempts,
            lastError: queue[i].lastError,
            updatedAt: queue[i].updatedAt
          });
          failed++;

          patchLocalCacheState(item.entityType, item.entityId, {
            _sync_state: 'manual_review_required',
            _sync_error: err.message
          });
        }
        writeSyncQueue(queue);
      }

      if (synced > 0) await refreshRemoteOrders();
      refreshLegacyInventoryProjection();
      await publishLegacyPosDeviceHealth().catch(() => {});
      return { synced, failed };
    } finally {
      state.syncInProgress = false;
    }
  });

  // ── Settings ───────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-settings', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      try {
        const { data, error } = await state.supabase.from('settings').select('*').eq('lodge_id', requireLodgeContext()).maybeSingle();
        if (!error && data) {
          writeCache('settings', data);
          return data;
        }
      } catch {}
      const cached = readObjectCacheForCurrentLodge('settings');
      if (cached) return cached;
      return null;
    }
    const cached = readObjectCacheForCurrentLodge('settings');
    if (cached) return cached;
    return null;
  });

  ipcMain.handle('pos:get-user-pos-access', () => ({ outletFilter: getUserOutletFilter() }));
  ipcMain.handle('pos:get-app-version', () => app.getVersion());
  ipcMain.handle('pos:get-low-resource-config', () => state.lowResource);
  ipcMain.handle('pos:get-mesh-status', () => ({ ...state.meshStatus }));
  ipcMain.handle('pos:mesh-sync-now', async () => {
    await legacyMeshController?.syncNow?.();
    return { ...state.meshStatus };
  });
  ipcMain.handle('pos:mesh-refresh-discovery', async () => {
    const next = await legacyMeshController?.refreshDiscovery?.();
    return next || { ...state.meshStatus };
  });
  ipcMain.handle('pos:mesh-connect-manual', async (_event, address) => {
    return legacyMeshController?.connectManual?.(address);
  });

  ipcMain.handle('pos:update-get-state', () => ({
    ...updateState,
    safety: getUpdateInstallSafety()
  }));

  ipcMain.handle('pos:update-get-install-safety', () => getUpdateInstallSafety());

  ipcMain.handle('pos:update-check', async () => checkForPosUpdates());

  ipcMain.handle('pos:update-download', async () => {
    if (!app.isPackaged) {
      const devState = setUpdateState({ phase: 'dev', error: '', progress: null });
      return { success: true, dev: true, state: devState };
    }
    if (!state.isOnline) {
      const offlineState = setUpdateState({
        phase: 'offline',
        error: 'Connect to the internet before downloading updates.',
        progress: null
      });
      return { success: false, offline: true, error: offlineState.error, state: offlineState };
    }
    try {
      setUpdateState({ phase: 'downloading', error: '' });
      await autoUpdater.downloadUpdate();
      return { success: true, state: { ...updateState } };
    } catch (error) {
      const next = setUpdateState({
        phase: 'error',
        error: error?.message || 'Update download failed.',
        progress: null
      });
      return { success: false, error: next.error, state: next };
    }
  });

  ipcMain.handle('pos:update-install', (_event, options = {}) => {
    const safety = getUpdateInstallSafety();
    if (safety.blocked && options.force !== true) {
      return { success: false, blocked: true, safety, error: 'Finish sync and close shifts before installing the update.' };
    }
    if (!app.isPackaged) return { success: true, dev: true, safety };
    setUpdateState({ phase: 'installing', error: '' });
    autoUpdater.quitAndInstall(false, true);
    return { success: true, safety };
  });

  ipcMain.handle('pos:get-inventory-diagnostics', async () => {
    const lodgeId = hasLodgeContext() ? requireLodgeContext() : null;
    if (!lodgeId) return { error: 'No lodge context' };
    const cachedInventory = readInventoryCache();
    const cachedOutlets = readArrayCacheForCurrentLodge('outlets');
    const cachedMenuItems = readMenuCache();
    const result = {
      lodge_id: lodgeId,
      outlet_filter: getUserOutletFilter(),
      cached_count: cachedInventory.length,
      remote_count: null,
      bar_outlet_count: null,
      bar_outlet_ids: [],
      bar_outlet_names: [],
      linked_menu_inventory_count: cachedMenuItems.filter((item) => item.inventory_item_id).length,
      unlinked_bar_inventory_count: null,
      error: null
    };
    let inventoryRows = cachedInventory;
    let outletRows = cachedOutlets;
    if (state.isOnline && state.supabase) {
      try {
        const [inventoryResult, outletResult] = await Promise.all([
          state.supabase.from('inventory_items')
            .select('id, name, category, outlet_id').eq('lodge_id', lodgeId),
          state.supabase.from('outlets')
            .select('id, name, type, is_active').eq('lodge_id', lodgeId)
        ]);
        if (inventoryResult.error) {
          result.error = inventoryResult.error.message;
        } else {
          inventoryRows = inventoryResult.data || [];
          result.remote_count = inventoryRows.length;
        }
        if (!outletResult.error && outletResult.data) {
          outletRows = outletResult.data.filter((outlet) => outlet?.is_active !== false);
        }
      } catch (e) {
        result.error = e?.message || 'Query failed';
      }
    }
    const isBarOutlet = (outlet) => {
      const text = `${outlet?.name || ''} ${outlet?.type || ''}`.toLowerCase();
      return text.includes('bar') || text.includes('beverage') || text.includes('drink');
    };
    const barOutlets = (outletRows || []).filter(isBarOutlet);
    const barOutletIds = barOutlets.map((outlet) => outlet.id).filter(Boolean);
    const linkedInventoryIds = new Set(cachedMenuItems.map((item) => item.inventory_item_id).filter(Boolean));
    const barInventoryRows = barOutletIds.length > 0
      ? (inventoryRows || []).filter((item) => barOutletIds.includes(item.outlet_id))
      : (inventoryRows || []).filter((item) => {
          const text = `${item?.name || ''} ${item?.category || ''}`.toLowerCase();
          return text.includes('bar') || text.includes('beer') || text.includes('wine') || text.includes('spirit') || text.includes('drink');
        });
    result.bar_outlet_ids = barOutletIds;
    result.bar_outlet_names = barOutlets.map((outlet) => outlet.name).filter(Boolean);
    result.bar_outlet_count = barInventoryRows.length;
    result.unlinked_bar_inventory_count = barInventoryRows.filter((item) => !linkedInventoryIds.has(item.id)).length;
    return result;
  });

  ipcMain.handle('pos:get-window-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { isFullscreen: false };
    return { isFullscreen: win.isFullScreen() };
  });

  ipcMain.handle('pos:toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { isFullscreen: false };
    const next = !win.isFullScreen();
    win.setFullScreen(next);
    return { isFullscreen: next };
  });

  ipcMain.handle('pos:bootstrap-reference-data', async () => {
    const results = { menu: false, inventory: false, settings: false, error: null };
    try {
      const lodgeId = hasLodgeContext() ? requireLodgeContext() : null;
      if (!lodgeId) {
        results.error = 'No lodge selected. Please log in and select a lodge.';
        return results;
      }
      if (state.isOnline && state.supabase) {
        const [menuResult, inventoryResult, settingsResult] = await Promise.allSettled([
          state.supabase.from('pos_menu_items')
            .select('id, name, category, price, is_available, barcode, inventory_item_id, depletion_qty, outlet_id, template_kind, lodge_id, created_at, updated_at')
            .eq('lodge_id', lodgeId).order('category').order('name').limit(state.lowResource.menuLimit),
          state.supabase.from('inventory_items')
            .select(INVENTORY_ITEM_SELECT).eq('lodge_id', lodgeId),
          state.supabase.from('settings').select('*').eq('lodge_id', lodgeId).maybeSingle()
        ]);
        if (menuResult.status === 'fulfilled' && !menuResult.value.error && menuResult.value.data?.length > 0) {
          writeCache('pos-menu-items', menuResult.value.data);
          results.menu = true;
        } else if (menuResult.status === 'fulfilled' && !menuResult.value.error && (!menuResult.value.data || menuResult.value.data.length === 0)) {
          const cached = readMenuCache();
          if (cached && cached.length > 0) results.menu = true;
        }
        if (inventoryResult.status === 'fulfilled' && !inventoryResult.value.error && inventoryResult.value.data?.length > 0) {
          const rows = inventoryResult.value.data.map((item) => ({ ...item, unit_cost: item.latest_unit_cost || 0 }));
          writeCache('inventory-items', rows);
          results.inventory = true;
        } else if (inventoryResult.status === 'fulfilled' && !inventoryResult.value.error && (!inventoryResult.value.data || inventoryResult.value.data.length === 0)) {
          const cached = readInventoryCache();
          if (cached && cached.length > 0) results.inventory = true;
        } else if (inventoryResult.status === 'fulfilled' && inventoryResult.value.error && isMissingInventoryCompatibilityColumnError(inventoryResult.value.error)) {
          const { data: fallbackData, error: fallbackError } = await state.supabase.from('inventory_items')
            .select(INVENTORY_ITEM_LEGACY_SELECT).eq('lodge_id', lodgeId);
          if (!fallbackError && fallbackData?.length > 0) {
            const rows = fallbackData.map((item) => ({ ...item, unit_cost: item.latest_unit_cost || 0 }));
            writeCache('inventory-items', rows);
            results.inventory = true;
          } else {
            const cached = readInventoryCache();
            if (cached && cached.length > 0) results.inventory = true;
          }
        }
        if (settingsResult.status === 'fulfilled' && settingsResult.value.data) {
          writeCache('settings', settingsResult.value.data);
          results.settings = true;
          results.settingsData = settingsResult.value.data;
        } else {
          const cached = readObjectCacheForCurrentLodge('settings');
          if (cached) {
            results.settings = true;
            results.settingsData = cached;
          }
        }
      }
    } catch (e) {
      results.error = e?.message || 'Bootstrap failed';
    }
    return results;
  });
}

function isMissingInventoryCompatibilityColumnError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('column') && (msg.includes('sku') || msg.includes('barcode') || msg.includes('is_active') || msg.includes('updated_at'));
}

// ── Low-memory Electron flags (must be set before app.whenReady) ────────────
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

// ── GitHub updater certificate compatibility for Windows POSReady 7 ─────────
// Some supported legacy terminals cannot validate GitHub's modern certificate
// chain. Keep this exception limited to the known GitHub release hosts used by
// electron-updater. Supabase and every other connection retain normal checks.
const GITHUB_UPDATE_CERT_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'githubusercontent.com',
  'raw.githubusercontent.com'
]);

function isGitHubUpdateCertificateHost(url = '') {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return GITHUB_UPDATE_CERT_HOSTS.has(host) || host.endsWith('.githubusercontent.com');
  } catch {
    return false;
  }
}

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isGitHubUpdateCertificateHost(url)) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

// ── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(isGitHubUpdateCertificateHost(request.hostname || request.url) ? 0 : -3);
  });
  state.cacheDir = getCacheDir();
  recoverFinancialQueue();
  startLegacyMesh();
  state.localConfig = readLocalConfig();
  state.runtimeConfig = readRuntimeConfig();
  state.lowResource = getLowResourceConfig(state.localConfig?.lowResource || {});
  const supabaseConfig = resolveSupabaseConfig();
  if (supabaseConfig?.url && supabaseConfig?.key) {
    initSupabase(supabaseConfig.url, supabaseConfig.key);
  }
  registerIpcHandlers();
  createWindow();
  setupAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      setupAutoUpdater();
    }
  });
});

app.on('before-quit', () => legacyMeshController?.stop?.());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
