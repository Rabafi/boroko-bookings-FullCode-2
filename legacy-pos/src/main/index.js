import dotenv from 'dotenv';
import { app, BrowserWindow, ipcMain } from 'electron';
import fetch, { Headers, Request, Response } from 'cross-fetch';
import WebSocket from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { normalizePosHardwareSettings } from '../shared/hardwareSettings.js';
import { buildCreatePosOrderPayload, buildVoidPayload, buildCashupPayload, normalizePaymentBreakdown } from '../shared/payloads.js';
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
  testPosHardwareDevice
} from './hardware/posHardwareAdapter.js';
import { LOW_RESOURCE, getLowResourceConfig } from '../shared/lowResource.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const devLegacyRoot = path.resolve(__dirname, '..', '..');
const devWorkspaceRoot = path.resolve(devLegacyRoot, '..');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_SELECT = 'id, auth_user_id, name, email, role, status, lodge_id, allowed_outlet_ids, pin_hash, capability_overrides';

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
  isOnline: false,
  currentUser: null,
  lodgeId: null,
  cacheDir: null,
  syncInProgress: false,
  localConfig: null,
  runtimeConfig: null,
  lowResource: getLowResourceConfig()
};

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

function normalizeUserProfile(user, authUser = null) {
  if (!user || typeof user !== 'object') return null;
  return {
    ...user,
    id: normalizeUuid(user.id) || user.id || authUser?.id || null,
    auth_user_id: normalizeUuid(user.auth_user_id || authUser?.id),
    email: normalizeEmail(user.email || authUser?.email),
    role: String(user.role || '').trim().toLowerCase(),
    status: String(user.status || 'active').trim().toLowerCase(),
    lodge_id: normalizeUuid(user.lodge_id),
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

async function resolveCurrentUserProfile(authUser) {
  if (!state.supabase || !authUser?.id) return null;
  const authId = normalizeUuid(authUser.id);
  const email = normalizeEmail(authUser.email);
  const profile =
    await lookupUserProfileBy('auth_user_id', authId, authUser) ||
    await lookupUserProfileBy('id', authId, authUser) ||
    await lookupUserProfileBy('email', email, authUser);
  if (!profile) {
    throw new Error('Login succeeded, but this Supabase account is not linked to a Boroko staff profile.');
  }
  if (profile.status && !['active', 'enabled'].includes(profile.status)) {
    throw new Error(`This staff account is ${profile.status}. Ask an administrator to reactivate it.`);
  }
  if (!profile.lodge_id) {
    throw new Error('Login succeeded, but this staff profile is not linked to a lodge.');
  }
  return profile;
}

function resolveSupabaseConfig() {
  const local = normalizeSupabaseConfig(state.localConfig || readLocalConfig(), 'local');
  if (local) return local;
  const runtime = normalizeSupabaseConfig(state.runtimeConfig || readRuntimeConfig(), 'runtime');
  if (runtime) return runtime;
  return readEnvConfig();
}

function initSupabase(url, key) {
  if (!url || !key) return false;
  installFetchCompat();
  state.supabase = createClient(url, key, {
    global: { fetch: globalThis.fetch },
    realtime: { transport: WebSocket },
    auth: { persistSession: false, autoRefreshToken: true }
  });
  state.isOnline = true;
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

function writeCache(name, data) {
  const filePath = path.join(state.cacheDir, `${name}.json`);
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) { try { fs.unlinkSync(tmpPath); } catch {} }
}

function readSyncQueue() { return readCache('sync-queue'); }
function writeSyncQueue(queue) { writeCache('sync-queue', queue); }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 600,
    title: 'Boroko POS Legacy',
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
    items: items.map((item) => ({
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

function registerIpcHandlers() {
  // ── Auth ───────────────────────────────────────────────────────────────────
  ipcMain.handle('pos:auth-login', async (_event, { email, password }) => {
    if (!state.supabase) throw new Error('Supabase not configured');
    const { data, error } = await state.supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
    if (error) throw new Error(error.message);
    const userData = await resolveCurrentUserProfile(data.user);
    state.currentUser = userData;
    state.lodgeId = userData.lodge_id;
    writeCache('current-session', { user: state.currentUser, lodgeId: state.lodgeId, session: data.session, savedAt: new Date().toISOString() });
    return { user: state.currentUser, lodgeId: state.lodgeId };
  });

  ipcMain.handle('pos:auth-restore', async () => {
    const saved = readCache('current-session');
    if (!saved?.session?.access_token || !state.supabase) return null;
    try {
      const { error } = await state.supabase.auth.setSession(saved.session);
      if (error) return null;
      const { data: authData } = await state.supabase.auth.getUser().catch(() => ({ data: null }));
      const authUser = authData?.user || saved.session?.user || saved.user;
      const userData = await resolveCurrentUserProfile(authUser);
      state.currentUser = userData;
      state.lodgeId = userData.lodge_id;
      writeCache('current-session', { user: state.currentUser, lodgeId: state.lodgeId, session: saved.session, savedAt: new Date().toISOString() });
      return { user: state.currentUser, lodgeId: state.lodgeId };
    } catch {
      state.currentUser = null;
      state.lodgeId = null;
      writeCache('current-session', null);
      return null;
    }
  });

  ipcMain.handle('pos:auth-logout', async () => {
    if (state.supabase) await state.supabase.auth.signOut().catch(() => {});
    state.currentUser = null;
    state.lodgeId = null;
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
      writeCache('pos-menu-items', data || []);
      return applyOutletFilter(data || [], outletFilter);
    }
    return applyOutletFilter(readCache('pos-menu-items'), outletFilter);
  });

  ipcMain.handle('pos:get-menu-item-by-id', async (_event, id) => {
    if (!id) return null;
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.from('pos_menu_items').select('*')
        .eq('id', id).eq('lodge_id', requireLodgeContext()).single();
      if (error) throw error;
      return data || null;
    }
    return readCache('pos-menu-items').find((item) => item.id === id) || null;
  });

  ipcMain.handle('pos:create-menu-item', async (_event, data) => {
    if (!state.isOnline || !state.supabase) throw new Error('No internet connection.');
    const payload = { lodge_id: requireLodgeContext(), name: data.name, category: data.category || 'Other', price: Number(data.price) || 0, is_available: data.is_available !== false, barcode: data.barcode || null, inventory_item_id: data.inventory_item_id || null, depletion_qty: data.inventory_item_id ? Number(data.depletion_qty) || 1 : null, outlet_id: data.outlet_id || null };
    const { data: result, error } = await state.supabase.rpc('create_pos_menu_item', { payload });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create POS menu item');
    return { success: true, id: result?.id };
  });

  ipcMain.handle('pos:update-menu-item', async (_event, id, data) => {
    if (!state.isOnline || !state.supabase) throw new Error('No internet connection.');
    const update = { name: data.name, category: data.category, price: Number(data.price), is_available: data.is_available, barcode: data.barcode || null, inventory_item_id: data.inventory_item_id || null, depletion_qty: data.inventory_item_id ? Number(data.depletion_qty) || 1 : null, ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {}) };
    const { data: result, error } = await state.supabase.rpc('update_pos_menu_item', { p_id: id, p_lodge_id: requireLodgeContext(), payload: update });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update POS menu item');
    return { success: true };
  });

  ipcMain.handle('pos:delete-menu-item', async (_event, id) => {
    if (!state.isOnline || !state.supabase) throw new Error('No internet connection.');
    const { data: result, error } = await state.supabase.rpc('delete_pos_menu_item', { p_id: id, p_lodge_id: requireLodgeContext() });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete POS menu item');
    return { success: true };
  });

  ipcMain.handle('pos:set-bar-pack-template', async (_event, data) => {
    if (!state.isOnline || !state.supabase) throw new Error('No internet connection.');
    const payload = { lodge_id: requireLodgeContext(), inventory_item_id: data.inventory_item_id, pack_size: Number(data.pack_size), enabled: data.enabled === true };
    const { data: result, error } = await state.supabase.rpc('set_bar_pos_pack_template', { payload });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update Bar POS template');
    return { success: true };
  });

  // ── Orders (with automatic offline queue on network error) ─────────────────
  ipcMain.handle('pos:create-order', async (_event, data) => {
    const lodgeId = requireLodgeContext();
    const payload = buildCreatePosOrderPayload({
      ...data,
      lodge_id: lodgeId,
      cashier_id: data.cashier_id || state.currentUser?.id,
      cashier_name: data.cashier_name || state.currentUser?.name
    });

    // Offline folio guard: block if no cached booking
    if (payload.payment_method === 'folio' && !payload.booking_id && !state.isOnline) {
      throw new Error('Room folio charge requires an active booking. Go online first or ensure the booking is cached locally.');
    }

    if (!state.isOnline || !state.supabase) {
      const queueItem = createQueueItem({
        functionName: 'create_pos_order',
        payload: { payload },
        entityType: 'pos_order',
        entityId: payload.id
      });
      const queue = readSyncQueue();
      queue.push(queueItem);
      writeSyncQueue(queue);

      const orderRow = {
        ...payload,
        status: 'completed',
        created_at: payload.created_at_client,
        _pending_sync: true,
        _sync_state: 'pending',
        _idempotency_key: payload.create_idempotency_key,
        _sync_created_offline: true,
        pos_order_items: payload.items.map((item, idx) => ({
          id: randomUUID(), order_id: payload.id, lodge_id: lodgeId, ...item,
          subtotal: Number(item.quantity || 0) * Number(item.unit_price || 0)
        }))
      };
      const cachedOrders = readCache('pos-orders');
      cachedOrders.unshift(orderRow);
      writeCache('pos-orders', cachedOrders);
      appendPrepTickets(orderRow, orderRow.pos_order_items);
      return { success: true, id: payload.id, offline: true };
    }

    // Online path
    try {
      const { data: result, error } = await state.supabase.rpc('create_pos_order', { payload });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Order failed');
      appendPrepTickets({ id: result.id || payload.id, ...payload }, payload.items);
      await refreshRemoteOrders();
      return { success: true, id: result.id || payload.id };
    } catch (rpcError) {
      // Network error → queue automatically with same payload
      if (isNetworkError(rpcError)) {
        const queueItem = createQueueItem({
          functionName: 'create_pos_order',
          payload: { payload },
          entityType: 'pos_order',
          entityId: payload.id
        });
        const queue = readSyncQueue();
        queue.push(queueItem);
        writeSyncQueue(queue);

        const orderRow = {
          ...payload,
          status: 'completed',
          created_at: payload.created_at_client,
          _pending_sync: true,
          _sync_state: 'pending',
          _idempotency_key: payload.create_idempotency_key,
          _sync_created_offline: true,
          pos_order_items: payload.items.map((item, idx) => ({
            id: randomUUID(), order_id: payload.id, lodge_id: lodgeId, ...item,
            subtotal: Number(item.quantity || 0) * Number(item.unit_price || 0)
          }))
        };
        const cachedOrders = readCache('pos-orders');
        cachedOrders.unshift(orderRow);
        writeCache('pos-orders', cachedOrders);
        appendPrepTickets(orderRow, orderRow.pos_order_items);
        return { success: true, id: payload.id, offline: true, queued: true };
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
      return applyOutletFilter(merged, outletFilter);
    }
    return applyOutletFilter(readCache('pos-orders'), outletFilter);
  });

  ipcMain.handle('pos:void-order', async (_event, payload) => {
    if (!state.isOnline || !state.supabase) throw new Error('Void requires online connection.');
    const voidPayload = buildVoidPayload({ ...payload, lodge_id: requireLodgeContext() });
    const { data: result, error } = await state.supabase.rpc('approve_pos_void_with_pin', { payload: voidPayload });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Void failed');
    await refreshRemoteOrders();
    return { success: true, override_log_id: voidPayload.override_log_id };
  });

  ipcMain.handle('pos:partial-return', async (_event, payload) => {
    if (!state.isOnline || !state.supabase) throw new Error('Partial return requires online connection.');
    const { data: result, error } = await state.supabase.rpc('create_pos_order', { payload: { ...payload, lodge_id: requireLodgeContext() } });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Return failed');
    await refreshRemoteOrders();
    return { success: true, id: result.id };
  });

  // ── Cash-Up ────────────────────────────────────────────────────────────────
  ipcMain.handle('pos:create-cashup', async (_event, payload) => {
    const cashupPayload = buildCashupPayload({
      ...payload, lodge_id: requireLodgeContext(),
      created_by: state.currentUser?.id, created_by_name: state.currentUser?.name
    });

    if (!state.isOnline || !state.supabase) {
      const queueItem = createQueueItem({
        functionName: 'upsert_pos_cashup',
        payload: { payload: cashupPayload },
        entityType: 'pos_cashup',
        entityId: cashupPayload.id
      });
      const queue = readSyncQueue();
      queue.push(queueItem);
      writeSyncQueue(queue);
      const cashups = readCache('pos-cashups');
      cashups.unshift({ ...cashupPayload, _pending_sync: true, _sync_state: 'pending' });
      writeCache('pos-cashups', cashups);
      return { success: true, id: cashupPayload.id, offline: true };
    }

    try {
      const { data: result, error } = await state.supabase.rpc('upsert_pos_cashup', { payload: cashupPayload });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Cash-up failed');
      const cashups = readCache('pos-cashups');
      cashups.unshift(cashupPayload);
      writeCache('pos-cashups', cashups);
      return { success: true, id: cashupPayload.id };
    } catch (rpcError) {
      if (isNetworkError(rpcError)) {
        const queueItem = createQueueItem({
          functionName: 'upsert_pos_cashup',
          payload: { payload: cashupPayload },
          entityType: 'pos_cashup',
          entityId: cashupPayload.id
        });
        const queue = readSyncQueue();
        queue.push(queueItem);
        writeSyncQueue(queue);
        const cashups = readCache('pos-cashups');
        cashups.unshift({ ...cashupPayload, _pending_sync: true, _sync_state: 'pending' });
        writeCache('pos-cashups', cashups);
        return { success: true, id: cashupPayload.id, offline: true };
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
        const rows = (data || []).map((r) => ({ ...r, outlet_name: r.outlets?.name || null }));
        if (rows.length > 0) writeCache('pos-cashups', rows);
        return rows.length > 0 ? rows : readCache('pos-cashups').slice(0, limit);
      } catch { return readCache('pos-cashups').slice(0, limit); }
    }
    return readCache('pos-cashups').slice(0, limit);
  });

  // ── Outlets ────────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-outlets', async () => {
    const normalizeOutletRows = (rows = []) => (rows || [])
      .filter(Boolean)
      .filter((row) => row.is_active !== false)
      .map((row, i) => ({
        ...row,
        id: row.id || null,
        name: row.name || `Outlet ${i + 1}`,
        type: row.type || 'accommodation',
        sort_order: Number(row.sort_order ?? i)
      }))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const buildVirtualOutlets = () => [
      { id: null, name: 'Kitchen', type: 'food', sort_order: 1, _virtual: true },
      { id: null, name: 'Bar', type: 'beverage', sort_order: 2, _virtual: true },
      { id: null, name: 'Others', type: 'accommodation', sort_order: 3, _virtual: true }
    ];
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const lodgeId = requireLodgeContext();
      try {
        let { data, error } = await state.supabase.from('outlets')
          .select('id, name, type, sort_order').eq('lodge_id', lodgeId).eq('is_active', true).order('sort_order');
        if (error) {
          const fallback = await state.supabase.from('outlets')
            .select('id, name, type, sort_order, is_active').eq('lodge_id', lodgeId).order('sort_order');
          data = fallback.data;
          error = fallback.error;
        }
        if (error) throw error;
        const normalized = normalizeOutletRows(data || []);
        if (normalized.length > 0) writeCache('outlets', normalized);
        const cached = readCache('outlets');
        if (normalized.length > 0) return normalized;
        if (cached.length > 0) return cached;
        const virtual = buildVirtualOutlets();
        writeCache('outlets', virtual);
        return virtual;
      } catch {
        const cached = readCache('outlets');
        return cached.length > 0 ? cached : buildVirtualOutlets();
      }
    }
    const cached = readCache('outlets');
    return cached.length > 0 ? cached : buildVirtualOutlets();
  });

  // ── Staff ──────────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-staff', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const lodgeId = requireLodgeContext();
      const { data, error } = await state.supabase.from('users')
        .select('id, name, email, role, pin_hash, allowed_outlet_ids').eq('lodge_id', lodgeId).eq('status', 'active');
      if (error) throw new Error(error.message);
      writeCache('users', data || []);
      return data || [];
    }
    return readCache('users');
  });

  ipcMain.handle('pos:get-approver-candidates', async () => {
    const cachedCandidates = () => readCache('users')
      .filter((u) => u?.pin_hash)
      .filter((u) => ['supervisor', 'manager', 'admin', 'super_admin'].includes(String(u.role || '').toLowerCase()));
    if (!state.isOnline || !hasLodgeContext()) return cachedCandidates();
    const { data, error } = await state.supabase.from('users')
      .select('id, name, role, pin_hash, allowed_outlet_ids')
      .eq('lodge_id', requireLodgeContext()).not('pin_hash', 'is', null)
      .in('role', ['supervisor', 'manager', 'admin', 'super_admin']);
    if (error) return cachedCandidates();
    return (data || []).filter((u) => u?.pin_hash);
  });

  // ── Inventory ──────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-inventory', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const lodgeId = requireLodgeContext();
      const { data, error } = await state.supabase.from('inventory_items')
        .select('id, name, current_stock, unit, latest_unit_cost, selling_price, outlet_id').eq('lodge_id', lodgeId);
      if (error) throw new Error(error.message);
      const rows = (data || []).map((item) => ({ ...item, unit_cost: item.latest_unit_cost || 0 }));
      writeCache('inventory-items', rows);
      return rows;
    }
    return readCache('inventory-items');
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
    if (!state.isOnline || !state.supabase) throw new Error('Online connection required.');
    const { data: result, error } = await state.supabase.rpc('upsert_pos_table', { payload: { ...table, lodge_id: requireLodgeContext() } });
    if (error) throw new Error(error.message);
    return result;
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
    if (!state.isOnline || !state.supabase) throw new Error('Online connection required.');
    const { data: result, error } = await state.supabase.rpc('upsert_pos_tab', { payload: { ...tab, lodge_id: requireLodgeContext() } });
    if (error) throw new Error(error.message);
    return result;
  });

  ipcMain.handle('pos:update-tab-status', async (_event, { tabId, status }) => {
    if (!state.isOnline || !state.supabase) throw new Error('Online connection required.');
    const { data: result, error } = await state.supabase.rpc('update_pos_tab_status', { p_tab_id: tabId, p_status: status });
    if (error) throw new Error(error.message);
    return result;
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
    if (!state.isOnline || !state.supabase) throw new Error('Online connection required to open a shift.');
    const { data: result, error } = await state.supabase.rpc('open_pos_shift', {
      p_lodge_id: requireLodgeContext(),
      p_cashier_id: state.currentUser?.id,
      p_cashier_name: state.currentUser?.name || state.currentUser?.email,
      p_opening_float: Number(data.opening_float) || 0,
      p_notes: data.notes || null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not open shift');
    const shifts = readCache('pos-shifts');
    shifts.unshift(result.shift || { id: result.id, ...data, status: 'open', opened_at: new Date().toISOString() });
    writeCache('pos-shifts', shifts);
    return result.shift || result;
  });

  ipcMain.handle('pos:close-shift', async (_event, { shiftId, closing_cash, notes }) => {
    if (!state.isOnline || !state.supabase) throw new Error('Online connection required to close a shift.');
    const { data: result, error } = await state.supabase.rpc('close_pos_shift', {
      p_shift_id: shiftId,
      p_lodge_id: requireLodgeContext(),
      p_closing_cash: Number(closing_cash) || 0,
      p_notes: notes || null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not close shift');
    const shifts = readCache('pos-shifts');
    const idx = shifts.findIndex((s) => s.id === shiftId);
    if (idx >= 0) shifts[idx] = { ...shifts[idx], ...result.shift, status: 'closed', closed_at: new Date().toISOString() };
    writeCache('pos-shifts', shifts);
    return result.shift || shifts[idx];
  });

  // ── Modifier Groups / Promotions / Floor Layout ──────────────────────────
  // Online data is the shared source of truth. Offline mode uses the last cache.
  ipcMain.handle('pos:get-modifier-groups', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.from('pos_modifier_groups')
        .select('id, lodge_id, outlet_id, name, options, required, max_select, active, updated_at')
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
    if (state.isOnline && state.supabase) {
      const { data: result, error } = await state.supabase.rpc('upsert_pos_modifier_groups', {
        payload: { lodge_id: requireLodgeContext(), groups: safeGroups }
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not save modifier groups');
    }
    writeCache('pos-modifier-groups', safeGroups);
    return true;
  });

  ipcMain.handle('pos:get-promotions', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data, error } = await state.supabase.from('pos_promotions')
        .select('id, lodge_id, outlet_id, name, discount_type, discount_value, applies_to_category, starts_at, ends_at, enabled, updated_at')
        .eq('lodge_id', requireLodgeContext()).eq('enabled', true).order('updated_at', { ascending: false }).limit(state.lowResource.configLimit);
      if (!error && data) {
        writeCache('pos-promotions', data);
        return data;
      }
    }
    return readCache('pos-promotions');
  });
  ipcMain.handle('pos:save-promotions', async (_event, promos) => {
    const safePromos = (promos || []).slice(0, 100);
    if (state.isOnline && state.supabase) {
      const { data: result, error } = await state.supabase.rpc('upsert_pos_promotions', {
        payload: { lodge_id: requireLodgeContext(), promotions: safePromos }
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not save promotions');
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
    if (state.isOnline && state.supabase) {
      const { data: result, error } = await state.supabase.rpc('upsert_pos_floor_layout', {
        payload: { lodge_id: requireLodgeContext(), layout: safeLayout }
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not save floor layout');
    }
    writeCache('pos-floor-layout', safeLayout);
    return true;
  });

  // ── POS History Export ─────────────────────────────────────────────────────
  ipcMain.handle('pos:export-history', async (_event, { startDate, endDate } = {}) => {
    const orders = await (async () => {
      if (state.isOnline && state.supabase && hasLodgeContext()) {
        let q = state.supabase.from('pos_orders')
          .select('id, created_at, walk_in_name, total, payment_method, outlet_id, table_name, cashier_name, status, pos_order_items(item_name, quantity, unit_price)')
          .eq('lodge_id', requireLodgeContext());
        if (startDate) q = q.gte('created_at', startDate);
        if (endDate) q = q.lte('created_at', endDate + 'T23:59:59.999Z');
        const { data, error } = await q.order('created_at', { ascending: false }).limit(state.lowResource.exportMaxRows);
        if (error) throw new Error(error.message);
        return data || [];
      }
      return readCache('pos-orders');
    })();
    const rows = [['Order ID', 'Date', 'Guest', 'Items', 'Total', 'Payment', 'Cashier', 'Status']];
    for (const o of orders) {
      const items = Array.isArray(o.pos_order_items) ? o.pos_order_items.map((i) => `${i.item_name} x${i.quantity}`).join('; ') : '';
      rows.push([String(o.id).slice(0, 8), o.created_at || '', o.walk_in_name || '', items, String(o.total || 0), o.payment_method || 'cash', o.cashier_name || '', o.status || '']);
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
        writeSyncQueue(queue);

        try {
          const { data: result, error } = await state.supabase.rpc(item.functionName, item.payload);
          if (error) throw new Error(error.message);
          if (result?.success === false && result?.error) throw new Error(result.error);

          queue[i] = markItemSynced(item);
          synced++;

          // Patch local state after successful replay
          if (item.entityType === 'pos_order') {
            patchLocalOrderState(item.entityId, {
              _pending_sync: false,
              _sync_state: 'synced',
              _server_id: result?.id || item.entityId,
              _synced_at: new Date().toISOString()
            });
          } else if (item.entityType === 'pos_cashup') {
            patchLocalCashupState(item.entityId, {
              _pending_sync: false,
              _sync_state: 'synced',
              _synced_at: new Date().toISOString()
            });
          } else if (item.entityType === 'pos_ticket') {
            patchLocalTicketState(item.entityId, {
              _pending_sync: false,
              _sync_state: 'synced',
              _synced_at: new Date().toISOString()
            });
          }
        } catch (err) {
          if (isNetworkError(err)) {
            queue[i] = markItemFailed(item, err.message);
          } else {
            // Business error → mark manual_review_required immediately
            queue[i] = { ...markItemFailed(item, err.message), status: 'manual_review_required' };
          }
          failed++;

          // Patch local state after failed replay
          if (item.entityType === 'pos_order') {
            patchLocalOrderState(item.entityId, {
              _sync_state: 'manual_review_required',
              _sync_error: err.message
            });
          } else if (item.entityType === 'pos_ticket') {
            patchLocalTicketState(item.entityId, {
              _sync_state: 'manual_review_required',
              _sync_error: err.message
            });
          }
        }
        writeSyncQueue(queue);
      }

      if (synced > 0) await refreshRemoteOrders();
      return { synced, failed };
    } finally {
      state.syncInProgress = false;
    }
  });

  // ── Settings ───────────────────────────────────────────────────────────────
  ipcMain.handle('pos:get-settings', async () => {
    if (state.isOnline && state.supabase && hasLodgeContext()) {
      const { data } = await state.supabase.from('settings').select('*').eq('lodge_id', requireLodgeContext()).single();
      if (data) writeCache('settings', data);
      return data || readCache('settings');
    }
    return readCache('settings');
  });

  ipcMain.handle('pos:get-user-pos-access', () => ({ outletFilter: getUserOutletFilter() }));
  ipcMain.handle('pos:get-app-version', () => app.getVersion());
  ipcMain.handle('pos:get-low-resource-config', () => state.lowResource);
}

// ── Low-memory Electron flags (must be set before app.whenReady) ────────────
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');

// ── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  state.cacheDir = getCacheDir();
  state.localConfig = readLocalConfig();
  state.runtimeConfig = readRuntimeConfig();
  state.lowResource = getLowResourceConfig(state.localConfig?.lowResource || {});
  const supabaseConfig = resolveSupabaseConfig();
  if (supabaseConfig?.url && supabaseConfig?.key) {
    initSupabase(supabaseConfig.url, supabaseConfig.key);
  }
  registerIpcHandlers();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
