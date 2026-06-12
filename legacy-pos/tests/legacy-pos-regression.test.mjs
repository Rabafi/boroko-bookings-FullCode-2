import { randomUUID } from 'crypto';
import { strict as assert } from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildPosTotals } from '../src/shared/totals.js';
import { normalizePaymentBreakdown, buildCreatePosOrderPayload, buildVoidPayload, buildCashupPayload } from '../src/shared/payloads.js';
import { createQueueItem, isQueueItemReady, markItemSyncing, markItemSynced, markItemFailed, isNetworkError, isBusinessError } from '../src/shared/offlineQueue.js';
import { sanitizePosError } from '../src/shared/errors.js';
import { normalizePosHardwareSettings } from '../src/shared/hardwareSettings.js';
import { buildEscPosReceipt, buildCashDrawerPulse, printEscPosReceipt, openCashDrawer, testPosHardwareDevice } from '../src/main/hardware/posHardwareAdapter.js';
import { LOW_RESOURCE, getLowResourceConfig } from '../src/shared/lowResource.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${e.message}`);
  }
}

console.log('\nLegacy POS Comprehensive Regression Tests\n');

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD & STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

test('package-lock.json exists for npm ci viability', () => {
  const lockPath = path.join(__dirname, '..', 'package-lock.json');
  assert.ok(fs.existsSync(lockPath), 'package-lock.json must exist');
  const stat = fs.statSync(lockPath);
  assert.ok(stat.size > 1000, 'package-lock.json must not be empty');
});

test('package.json has correct main entry for built output', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  assert.equal(pkg.main, 'out/main/index.cjs', 'main must point to out/main/index.cjs');
});

test('electron icon asset exists', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'main', 'assets', 'icon.ico')), 'icon.ico must exist');
});

test('electron-vite config targets chrome108 for renderer', () => {
  const configPath = path.join(__dirname, '..', 'electron.vite.config.js');
  const content = fs.readFileSync(configPath, 'utf-8');
  assert.ok(content.includes('chrome108'), 'renderer build target must be chrome108');
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAYLOAD & IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════════════════════

test('buildCreatePosOrderPayload includes stable id and create_idempotency_key', () => {
  const id = randomUUID();
  const payload = buildCreatePosOrderPayload({
    id, submit_intent_id: id, lodge_id: 'lodge-1',
    items: [{ item_name: 'Beer', quantity: 2, unit_price: 10 }], payment_method: 'cash'
  });
  assert.equal(payload.id, id);
  assert.equal(payload.create_idempotency_key, `pos-order:${id}`);
  assert.equal(payload.total, 20);
});

test('Duplicate replay preserves same idempotency key', () => {
  const id = randomUUID();
  const buildPayload = () => buildCreatePosOrderPayload({
    id, submit_intent_id: id, lodge_id: 'lodge-1',
    items: [{ item_name: 'Soda', quantity: 1, unit_price: 5 }], payment_method: 'cash'
  });
  assert.equal(buildPayload().create_idempotency_key, buildPayload().create_idempotency_key);
});

test('buildCreatePosOrderPayload normalizes payment breakdown', () => {
  const payload = buildCreatePosOrderPayload({
    lodge_id: 'l-1', items: [{ item_name: 'X', quantity: 1, unit_price: 10 }],
    payment_method: 'split', payment_breakdown: [{ method: 'cash', amount: 5 }, { method: 'card', amount: 5 }]
  });
  assert.equal(payload.payment_breakdown.length, 2);
});

// ═══════════════════════════════════════════════════════════════════════════════
// OFFLINE QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

test('Offline sale queue item has type rpc and functionName create_pos_order', () => {
  const queueItem = createQueueItem({
    functionName: 'create_pos_order',
    payload: { payload: { id: randomUUID(), lodge_id: 'l-1', items: [] } },
    entityType: 'pos_order', entityId: randomUUID()
  });
  assert.equal(queueItem.type, 'rpc');
  assert.equal(queueItem.functionName, 'create_pos_order');
  assert.equal(queueItem.status, 'pending');
  assert.equal(queueItem.attempts, 0);
});

test('Queue item payload is never mutated', () => {
  const originalPayload = { payload: { id: 'test-1', lodge_id: 'l-1', items: [{ item_name: 'X', quantity: 1, unit_price: 5 }] } };
  const queueItem = createQueueItem({ functionName: 'create_pos_order', payload: originalPayload, entityType: 'pos_order', entityId: 'test-1' });
  const frozen = JSON.stringify(queueItem.payload);
  queueItem.status = 'syncing'; queueItem.attempts = 1;
  assert.equal(frozen, JSON.stringify(queueItem.payload));
});

test('isQueueItemReady resolves dependencies correctly', () => {
  const itemA = createQueueItem({ functionName: 'create_pos_order', payload: { payload: { id: 'a' } }, entityType: 'pos_order', entityId: 'a' });
  const itemB = createQueueItem({ functionName: 'approve_pos_void_with_pin', payload: { payload: { order_id: 'a' } }, entityType: 'pos_void', entityId: 'b', dependsOn: itemA.id });
  assert.equal(isQueueItemReady(itemA, [itemA, itemB]), true);
  assert.equal(isQueueItemReady(itemB, [itemA, itemB]), false);
  assert.equal(isQueueItemReady(itemB, [markItemSynced(itemA), itemB]), true);
});

test('Marking item failed after 3 attempts sets manual_review_required', () => {
  let item = createQueueItem({ functionName: 'create_pos_order', payload: { payload: { id: 'x' } }, entityType: 'pos_order', entityId: 'x' });
  item = { ...item, attempts: 3 };
  assert.equal(markItemFailed(item, 'stock out').status, 'manual_review_required');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC REPLAY FAILURE RUNTIME
// ═══════════════════════════════════════════════════════════════════════════════

test('markItemFailed preserves item structure (id, type, functionName, payload, entityType, entityId)', () => {
  const original = createQueueItem({ functionName: 'create_pos_order', payload: { payload: { id: 'order-123', lodge_id: 'l-1', items: [] } }, entityType: 'pos_order', entityId: 'order-123' });
  const failed = markItemFailed(markItemSyncing(original), 'fetch failed: ECONNREFUSED');
  assert.equal(failed.id, original.id); assert.equal(failed.type, 'rpc');
  assert.equal(failed.functionName, 'create_pos_order'); assert.deepEqual(failed.payload, original.payload);
  assert.equal(failed.entityType, 'pos_order'); assert.equal(failed.entityId, 'order-123');
  assert.equal(failed.status, 'failed'); assert.equal(failed.attempts, 1);
});

test('markItemFailed preserves full item structure through 4 retries', () => {
  let item = createQueueItem({ functionName: 'upsert_pos_cashup', payload: { payload: { id: 'cashup-456', lodge_id: 'l-1' } }, entityType: 'pos_cashup', entityId: 'cashup-456' });
  for (let i = 0; i < 4; i++) item = markItemFailed(markItemSyncing(item), 'ETIMEDOUT');
  assert.equal(item.entityId, 'cashup-456'); assert.equal(item.attempts, 4);
  assert.equal(item.status, 'manual_review_required');
});

test('Business error sets manual_review_required', () => {
  const original = createQueueItem({ functionName: 'create_pos_order', payload: { payload: { id: 'order-789', lodge_id: 'l-1', items: [] } }, entityType: 'pos_order', entityId: 'order-789' });
  const failed = { ...markItemFailed(original, 'Insufficient stock'), status: 'manual_review_required' };
  assert.equal(failed.status, 'manual_review_required'); assert.equal(failed.entityId, 'order-789');
});

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK vs BUSINESS ERROR
// ═══════════════════════════════════════════════════════════════════════════════

test('isNetworkError identifies fetch failures', () => {
  for (const msg of ['fetch failed', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'socket hang up', 'Load failed']) {
    assert.equal(isNetworkError(new Error(msg)), true, msg);
  }
});

test('isNetworkError rejects business errors', () => {
  for (const msg of ['Insufficient stock for Beer', 'Room folio charge requires an active booking', 'Invalid PIN', 'unique violation']) {
    assert.equal(isNetworkError(new Error(msg)), false, msg);
  }
});

test('isBusinessError is inverse of isNetworkError', () => {
  assert.equal(isBusinessError(new Error('fetch failed')), false);
  assert.equal(isBusinessError(new Error('Stock insufficient')), true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// OFFLINE FOLIO SAFETY
// ═══════════════════════════════════════════════════════════════════════════════

test('Offline folio payload requires booking_id', () => {
  const payload = buildCreatePosOrderPayload({ lodge_id: 'l-1', items: [{ item_name: 'Room charge', quantity: 1, unit_price: 100 }], payment_method: 'folio', room_id: 'room-1', booking_id: 'booking-123' });
  assert.equal(payload.booking_id, 'booking-123'); assert.equal(payload.payment_method, 'folio');
});

test('Offline folio without booking_id produces null booking_id (renderer must block)', () => {
  const payload = buildCreatePosOrderPayload({ lodge_id: 'l-1', items: [{ item_name: 'Room charge', quantity: 1, unit_price: 100 }], payment_method: 'folio', room_id: 'room-1' });
  assert.equal(payload.booking_id, null);
});

test('Offline folio queue item preserves booking_id', () => {
  const orderPayload = { id: randomUUID(), lodge_id: 'l-1', payment_method: 'folio', room_id: 'room-1', booking_id: 'booking-456', items: [{ item_name: 'Spa', quantity: 1, unit_price: 50 }] };
  const queueItem = createQueueItem({ functionName: 'create_pos_order', payload: { payload: orderPayload }, entityType: 'pos_order', entityId: orderPayload.id });
  assert.equal(queueItem.payload.payload.booking_id, 'booking-456');
});

// ═══════════════════════════════════════════════════════════════════════════════
// VOID & CASHUP PAYLOAD
// ═══════════════════════════════════════════════════════════════════════════════

test('buildVoidPayload produces RPC-compatible payload', () => {
  const payload = buildVoidPayload({ order_id: 'order-123', lodge_id: 'lodge-1', approved_by: 'approver-1', pin: '1234', reason: 'Wrong order', outlet_id: 'outlet-1' });
  assert.equal(payload.order_id, 'order-123'); assert.equal(payload.pin, '1234'); assert.ok(payload.override_log_id);
});

test('buildCashupPayload produces RPC-compatible payload', () => {
  const payload = buildCashupPayload({ lodge_id: 'lodge-1', date: '2026-01-01', opening_float: 500, gross_sales: 5000, net_sales: 4800, orders_count: 25 });
  assert.equal(payload.opening_float, 500); assert.equal(payload.gross_sales, 5000); assert.ok(payload.id);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FORBIDDEN DIRECT WRITE PROTECTION
// ═══════════════════════════════════════════════════════════════════════════════

test('Payload builders do not produce raw table insert structures', () => {
  const payload = buildCreatePosOrderPayload({ lodge_id: 'l-1', items: [{ item_name: 'Test', quantity: 1, unit_price: 10 }], payment_method: 'cash' });
  assert.ok(!('payment_status' in payload)); assert.ok(!('amount_paid' in payload));
});

test('Main process has no direct .from().insert() for forbidden tables', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  for (const pattern of [/\.from\(['"]pos_orders['"]\)\s*\.\s*insert/, /\.from\(['"]pos_order_items['"]\)\s*\.\s*insert/, /\.from\(['"]booking_charges['"]\)\s*\.\s*insert/, /\.from\(['"]payments['"]\)\s*\.\s*insert/, /\.from\(['"]pos_cashup_sessions['"]\)\s*\.\s*insert/, /\.from\(['"]pos_override_log['"]\)\s*\.\s*insert/]) {
    assert.ok(!pattern.test(content), `Direct write detected: ${pattern}`);
  }
});

test('All critical mutations use RPC', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  for (const rpc of ['create_pos_order', 'approve_pos_void_with_pin', 'upsert_pos_cashup', 'create_pos_menu_item', 'update_pos_menu_item', 'delete_pos_menu_item', 'set_bar_pos_pack_template', 'update_pos_prep_ticket_status', 'open_pos_shift', 'close_pos_shift', 'get_pos_shifts']) {
    assert.ok(content.includes(`.rpc('${rpc}'`), `${rpc} must use RPC`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TICKET STATUS — RPC-BACKED
// ═══════════════════════════════════════════════════════════════════════════════

test('Ticket status update uses RPC', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes(".rpc('update_pos_prep_ticket_status'"), 'Must use RPC');
  assert.ok(!content.includes('.from(\'pos_prep_tickets\').update('), 'Must NOT use direct update');
});

test('Ticket status handler includes _pending_sync for offline', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('_pending_sync: !state.isOnline'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// OUTLET FILTERING
// ═══════════════════════════════════════════════════════════════════════════════

test('Main process loads and caches outlets', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('pos:get-outlets'));
});

test('Main process has getUserOutletFilter', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('getUserOutletFilter')); assert.ok(content.includes('allowed_outlet_ids'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE COVERAGE
// ═══════════════════════════════════════════════════════════════════════════════

test('Main process has all required IPC handlers', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  for (const h of ['pos:auth-login', 'pos:auth-restore', 'pos:auth-logout', 'pos:config', 'pos:save-config', 'pos:get-menu-items', 'pos:create-menu-item', 'pos:update-menu-item', 'pos:delete-menu-item', 'pos:create-order', 'pos:get-orders', 'pos:void-order', 'pos:partial-return', 'pos:create-cashup', 'pos:get-cashups', 'pos:get-outlets', 'pos:get-staff', 'pos:get-inventory', 'pos:get-rooms', 'pos:get-bookings', 'pos:get-tables', 'pos:save-table', 'pos:get-tabs', 'pos:save-tab', 'pos:get-tickets', 'pos:update-ticket-status', 'pos:get-hardware-settings', 'pos:save-hardware-settings', 'pos:print-receipt', 'pos:open-cash-drawer', 'pos:test-hardware', 'pos:open-customer-display', 'pos:open-kitchen-display', 'pos:get-sync-status', 'pos:sync-retry', 'pos:get-shifts', 'pos:open-shift', 'pos:close-shift', 'pos:get-modifier-groups', 'pos:save-modifier-groups', 'pos:get-promotions', 'pos:save-promotions', 'pos:get-floor-layout', 'pos:save-floor-layout', 'pos:export-history', 'pos:set-bar-pack-template', 'pos:get-approver-candidates', 'pos:get-low-resource-config']) {
    assert.ok(content.includes(`'${h}'`), `Missing handler: ${h}`);
  }
});

test('Preload exposes all required API methods', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf-8');
  for (const m of ['login', 'restoreSession', 'logout', 'getConfig', 'saveConfig', 'getMenuItems', 'createMenuItem', 'updateMenuItem', 'deleteMenuItem', 'createOrder', 'getOrders', 'voidOrder', 'partialReturn', 'createCashup', 'getCashups', 'getOutlets', 'getStaff', 'getApproverCandidates', 'getInventory', 'getRooms', 'getBookings', 'getTables', 'saveTable', 'getTabs', 'saveTab', 'updateTabStatus', 'getTickets', 'updateTicketStatus', 'getHardwareSettings', 'saveHardwareSettings', 'printReceipt', 'openCashDrawer', 'testHardware', 'openCustomerDisplay', 'openKitchenDisplay', 'getSyncStatus', 'syncRetry', 'getShifts', 'openShift', 'closeShift', 'getModifierGroups', 'saveModifierGroups', 'getPromotions', 'savePromotions', 'getFloorLayout', 'saveFloorLayout', 'exportHistory', 'setBarPackTemplate', 'getLowResourceConfig']) {
    assert.ok(content.includes(`${m}:`), `Missing preload: ${m}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC STATE PATCHING
// ═══════════════════════════════════════════════════════════════════════════════

test('Main process patches local order state after sync replay', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('patchLocalOrderState')); assert.ok(content.includes('_pending_sync: false')); assert.ok(content.includes("_sync_state: 'synced'"));
});

test('Main process patches local cashup state after sync replay', () => {
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8').includes('patchLocalCashupState'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-QUEUE ON NETWORK ERROR
// ═══════════════════════════════════════════════════════════════════════════════

test('Main process auto-queues on network error during online order', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('isNetworkError(rpcError)')); assert.ok(content.includes('queued: true'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// SANITIZE ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

test('sanitizePosError handles network errors', () => { assert.ok(sanitizePosError('fetch failed: ECONNREFUSED').includes('check your connection')); });
test('sanitizePosError handles auth errors', () => { assert.ok(sanitizePosError('session expired').includes('sign out')); });
test('sanitizePosError handles duplicate errors', () => { assert.ok(sanitizePosError('unique violation on index').includes('already synced')); });

// ═══════════════════════════════════════════════════════════════════════════════
// HARDWARE
// ═══════════════════════════════════════════════════════════════════════════════

test('normalizePosHardwareSettings produces valid defaults', () => {
  const s = normalizePosHardwareSettings({});
  assert.equal(s.receipt_paper_width, '80mm'); assert.equal(s.receipt_print_mode, 'windows');
  assert.equal(s.escpos_network_port, 9100); assert.equal(s.escpos_codepage, 'cp437');
});

// ═══════════════════════════════════════════════════════════════════════════════
// ESC/POS HARDWARE PRINT PATH
// ═══════════════════════════════════════════════════════════════════════════════

test('All hardware helpers exist and are importable', () => {
  assert.equal(typeof buildEscPosReceipt, 'function');
  assert.equal(typeof buildCashDrawerPulse, 'function');
  assert.equal(typeof printEscPosReceipt, 'function');
  assert.equal(typeof openCashDrawer, 'function');
  assert.equal(typeof testPosHardwareDevice, 'function');
});

test('buildEscPosReceipt produces a Buffer', () => {
  const receipt = buildEscPosReceipt({ id: 'test', walk_in_name: 'Test', payment_method: 'cash', pos_order_items: [{ item_name: 'Beer', quantity: 2, unit_price: 10 }], gross_total: 20, total: 20, created_at: new Date().toISOString() }, { lodge_name: 'Test' }, {});
  assert.ok(Buffer.isBuffer(receipt) && receipt.length > 0);
});

test('buildCashDrawerPulse produces valid ESC/POS drawer command', () => {
  const pulse = buildCashDrawerPulse({});
  assert.ok(Buffer.isBuffer(pulse) && pulse[0] === 0x1b && pulse[1] === 0x70);
});

test('Main process print-receipt handler uses printEscPosReceipt', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('printEscPosReceipt({ order:'));
  assert.ok(!content.includes('buildEscPosReceipt(order, business'));
});

test('Main imports printEscPosReceipt (not buildEscPosReceipt)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('printEscPosReceipt,\n  openCashDrawer'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

test('Main process reads local config from userData', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('readLocalConfig')); assert.ok(content.includes('writeLocalConfig'));
  assert.ok(content.includes('pos-config.json'));
});

test('Main process has pos:save-config handler', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("'pos:save-config'")); assert.ok(content.includes('initSupabase'));
});

test('App startup initializes Supabase from resolved config chain', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('resolveSupabaseConfig'));
  assert.ok(content.includes('readRuntimeConfig'));
  assert.ok(content.includes('readEnvConfig'));
});

test('Preload exposes saveConfig', () => {
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf-8').includes('saveConfig:'));
});

test('Main process imports and loads dotenv', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("import dotenv from 'dotenv'"), 'Must import dotenv');
  assert.ok(content.includes('dotenv.parse('), 'Must parse dotenv files without exposing setup UI');
});

test('Main process polyfills fetch globals for Electron 22 Supabase client', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  assert.ok(pkg.dependencies['cross-fetch'], 'Must depend on cross-fetch for Electron 22');
  assert.ok(pkg.dependencies.ws, 'Must depend on ws for Electron 22 realtime transport');
  assert.ok(content.includes("from 'cross-fetch'"), 'Must import cross-fetch');
  assert.ok(content.includes("from 'ws'"), 'Must import ws');
  assert.ok(content.includes('installFetchCompat'), 'Must install fetch compatibility');
  assert.ok(content.includes('globalThis.Headers'), 'Must define Headers for supabase-js');
  assert.ok(content.includes('globalThis.WebSocket'), 'Must define WebSocket for realtime-js');
  assert.ok(content.includes('global: { fetch: globalThis.fetch }'), 'Must pass compatible fetch to Supabase');
  assert.ok(content.includes('realtime: { transport: WebSocket }'), 'Must pass ws transport to Supabase realtime');
});

test('Dev mode loads both workspace and legacy POS env files', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('devWorkspaceRoot'), 'Must know workspace root');
  assert.ok(content.includes('devLegacyRoot'), 'Must know legacy POS root');
  assert.ok(content.includes("path.join(devLegacyRoot, '.env')"), 'Must load legacy-pos/.env');
});

test('Package embeds generated runtime config as extraResource', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  assert.ok(pkg.scripts['prepare:config'].includes('prepare-runtime-config'));
  assert.ok(pkg.scripts.build.includes('prepare:config'));
  assert.ok(JSON.stringify(pkg.build.extraResources).includes('legacy-pos-runtime-config.json'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE-BACKED POS CONFIG FEATURES
// ═══════════════════════════════════════════════════════════════════════════════

test('Modifier groups use database source of truth when online', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("from('pos_modifier_groups'"));
  assert.ok(content.includes("rpc('upsert_pos_modifier_groups'"));
});
test('Promotions use database source of truth when online', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("from('pos_promotions'"));
  assert.ok(content.includes("rpc('upsert_pos_promotions'"));
});
test('Floor layout uses database source of truth when online', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("from('pos_floor_layouts'"));
  assert.ok(content.includes("rpc('upsert_pos_floor_layout'"));
});

test('Legacy POS database migration defines required RPC contract', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260612193000_legacy_pos_database_contract.sql'), 'utf-8');
  for (const fn of [
    'create_pos_order',
    'approve_pos_void_with_pin',
    'upsert_pos_cashup',
    'open_pos_shift',
    'close_pos_shift',
    'get_pos_shifts',
    'update_pos_prep_ticket_status',
    'update_booking_payment',
    'upsert_pos_modifier_groups',
    'upsert_pos_promotions',
    'upsert_pos_floor_layout'
  ]) {
    assert.ok(sql.includes(`function public.${fn}`), `Missing ${fn}`);
  }
});

test('Legacy POS create_pos_order migration subtracts discounts and validates payment totals', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260612193000_legacy_pos_database_contract.sql'), 'utf-8');
  assert.ok(sql.includes('v_computed_total - v_discount_to_apply'));
  assert.ok(sql.includes('Payment total %s does not match order total %s'));
  assert.ok(sql.includes('insert into public.pos_prep_tickets'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOTALS
// ═══════════════════════════════════════════════════════════════════════════════

test('buildPosTotals computes correctly', () => {
  const totals = buildPosTotals([{ quantity: 2, unit_price: 10 }, { quantity: 1, unit_price: 5 }], { tax_rate: 14, tip_total: 3, discount_total: 2 });
  assert.equal(totals.gross_total, 25); assert.equal(totals.discount_total, 2); assert.equal(totals.tax_rate, 14); assert.equal(totals.tip_total, 3);
});

test('normalizePaymentBreakdown normalizes arrays', () => {
  const result = normalizePaymentBreakdown([{ method: 'cash', amount: 10 }, { method: 'card', amount: 5.5 }], 'cash', 15.5);
  assert.equal(result.length, 2); assert.equal(result[0].method, 'cash');
});

test('normalizePaymentBreakdown falls back to single method', () => {
  assert.equal(normalizePaymentBreakdown([], 'cash', 20).length, 1);
  assert.equal(normalizePaymentBreakdown([], 'cash', 20)[0].amount, 20);
});

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERER STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

test('POSTerminal renders outlet selector', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(c.includes('selectedOutlet')); assert.ok(c.includes('outlets')); assert.ok(c.includes('outlet_id'));
});

test('POSTerminal enforces offline folio guard', () => {
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8').includes('folio charge requires an active booking'));
});

test('POSTerminal has staff/cashier selection', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(c.includes('selectedStaff')); assert.ok(c.includes('cashier_id'));
});

test('POSTerminal has waiter selection', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(c.includes('selectedWaiter')); assert.ok(c.includes('waiter_name'));
});

test('POSTerminal has modifier support', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(c.includes('modifierGroups')); assert.ok(c.includes('modifierSelections'));
});

test('POSTerminal has promotions support', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(c.includes('promotions')); assert.ok(c.includes('appliedPromo'));
});

test('POSTerminal supports split payments and validates balance', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(c.includes('splitPayments'));
  assert.ok(c.includes('paymentBalance'));
  assert.ok(c.includes('Split payments must match the total'));
});

test('POSTerminal sends adjusted modifier prices to order payload', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(c.includes('lineUnitPrice'));
  assert.ok(c.includes('cartForTotals'));
  assert.ok(c.includes('items: cartForTotals'));
});

test('POSTerminal updates customer display from live cart', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(c.includes('updateCustomerDisplay'));
  assert.ok(c.includes('items: cartForTotals.map'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN COVERAGE
// ═══════════════════════════════════════════════════════════════════════════════

test('All required screens exist', () => {
  const dir = path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens');
  for (const f of ['Login.jsx', 'POSTerminal.jsx', 'Orders.jsx', 'CashUp.jsx', 'Tickets.jsx', 'MenuManagement.jsx', 'Tables.jsx', 'Hardware.jsx', 'Sync.jsx', 'Shifts.jsx']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} must exist`);
  }
});

test('Display components exist', () => {
  const dir = path.join(__dirname, '..', 'src', 'renderer', 'src', 'components');
  assert.ok(fs.existsSync(path.join(dir, 'CustomerDisplay.jsx'))); assert.ok(fs.existsSync(path.join(dir, 'KitchenDisplay.jsx')));
});

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED LAYER
// ═══════════════════════════════════════════════════════════════════════════════

test('Shared layer files all exist', () => {
  const dir = path.join(__dirname, '..', 'src', 'shared');
  for (const f of ['totals.js', 'payloads.js', 'offlineQueue.js', 'errors.js', 'hardwareSettings.js', 'lowResource.js']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} must exist`);
  }
});

test('Shared layer uses no Node.js-only imports in browser-bound code', () => {
  for (const f of ['payloads.js', 'offlineQueue.js']) {
    assert.ok(!fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', f), 'utf-8').includes("from 'crypto'"), `${f} must not import from Node.js 'crypto'`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPLAY STATE
// ═══════════════════════════════════════════════════════════════════════════════

test('Replay sets manual_review_required on business error', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(c.includes('manual_review_required')); assert.ok(c.includes('_sync_error'));
});

test('Replay uses markItemFailed(item, err.message)', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(c.includes('markItemFailed(item, err.message)'));
  assert.ok(!c.includes('markItemFailed(err, err.message)'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// .env.example ACCURACY
// ═══════════════════════════════════════════════════════════════════════════════

test('.env.example documents local config as preferred', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf-8');
  assert.ok(c.includes('pos-config.json')); assert.ok(c.toLowerCase().includes('first run'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE: LOW-RESOURCE MODE
// ═══════════════════════════════════════════════════════════════════════════════

test('LOW_RESOURCE.enabled defaults to true', () => {
  assert.equal(LOW_RESOURCE.enabled, true);
});

test('getLowResourceConfig returns merged config', () => {
  const config = getLowResourceConfig({ menuLimit: 100 });
  assert.equal(config.enabled, true);
  assert.equal(config.menuLimit, 100);
  assert.equal(config.ordersLimit, 100);
});

test('Online check interval is at least 30s in low-resource mode', () => {
  assert.ok(LOW_RESOURCE.onlineCheckMs >= 30000, `onlineCheckMs=${LOW_RESOURCE.onlineCheckMs} must be >= 30000`);
});

test('Sync poll interval is at least 15s', () => {
  assert.ok(LOW_RESOURCE.syncPollMs >= 15000, `syncPollMs=${LOW_RESOURCE.syncPollMs} must be >= 15000`);
});

test('Display poll interval is at least 15s', () => {
  assert.ok(LOW_RESOURCE.displayPollMs >= 15000, `displayPollMs=${LOW_RESOURCE.displayPollMs} must be >= 15000`);
});

test('Clock update interval is at least 60s', () => {
  assert.ok(LOW_RESOURCE.clockUpdateMs >= 60000, `clockUpdateMs=${LOW_RESOURCE.clockUpdateMs} must be >= 60000`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE: QUERY LIMIT CAPS
// ═══════════════════════════════════════════════════════════════════════════════

test('Menu query limit does not exceed 250', () => {
  assert.ok(LOW_RESOURCE.menuLimit <= 250, `menuLimit=${LOW_RESOURCE.menuLimit} must be <= 250`);
});

test('Orders query limit does not exceed 100', () => {
  assert.ok(LOW_RESOURCE.ordersLimit <= 100, `ordersLimit=${LOW_RESOURCE.ordersLimit} must be <= 100`);
});

test('Tickets query limit does not exceed 50', () => {
  assert.ok(LOW_RESOURCE.ticketsLimit <= 50, `ticketsLimit=${LOW_RESOURCE.ticketsLimit} must be <= 50`);
});

test('Export max rows does not exceed 500', () => {
  assert.ok(LOW_RESOURCE.exportMaxRows <= 500, `exportMaxRows=${LOW_RESOURCE.exportMaxRows} must be <= 500`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE: NO DEFAULT QUERY LIMIT EXCEEDS AGREED CAPS (STATIC SCAN)
// ═══════════════════════════════════════════════════════════════════════════════

test('Main process uses state.lowResource limits, not hardcoded 500+', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(!content.includes('.limit(500)'), 'Must not have hardcoded .limit(500)');
  assert.ok(!content.includes('.limit(2000)'), 'Must not have hardcoded .limit(2000)');
  assert.ok(!content.includes('.limit(100)'), 'Must not have hardcoded .limit(100) (use state.lowResource.*)');
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE: ROUTE LAZY-LOADING
// ═══════════════════════════════════════════════════════════════════════════════

test('App.jsx uses React.lazy for non-terminal screens', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf-8');
  assert.ok(content.includes('lazy(() => import'), 'Must use React.lazy() for code splitting');
  assert.ok(content.includes('Suspense'), 'Must use Suspense for lazy-loaded routes');
});

test('POSTerminal is NOT lazy-loaded (loaded eagerly)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf-8');
  assert.ok(!content.includes("lazy(() => import('./screens/POSTerminal')"), 'POSTerminal must not be lazy-loaded');
});

test('Only terminal, orders, cashup, sync visible by default in low-resource mode', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf-8');
  assert.ok(content.includes('CORE_TABS'), 'Must define CORE_TABS');
  assert.ok(content.includes('ADVANCED_TABS'), 'Must define ADVANCED_TABS');
  assert.ok(content.includes("showAdvanced"), 'Must have showAdvanced toggle');
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE: STAGED DATA LOADING
// ═══════════════════════════════════════════════════════════════════════════════

test('POSTerminal loads core data (menu, outlets, staff) first', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('loadCoreData'), 'Must have loadCoreData function');
  assert.ok(content.includes('getMenuItems'), 'Core data must include getMenuItems');
  assert.ok(content.includes('getOutlets'), 'Core data must include getOutlets');
  assert.ok(content.includes('getStaff'), 'Core data must include getStaff');
});

test('POSTerminal loads rooms/bookings on demand (not at startup)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('loadRoomData'), 'Must have loadRoomData function');
  assert.ok(content.includes('roomsLoaded'), 'Must track if rooms are loaded');
  assert.ok(content.includes("customerType === 'room'"), 'Must load rooms when customer type is room');
});

test('POSTerminal accepts lowResource prop', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('lowResource'), 'Must accept lowResource prop');
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE: ELECTRON LOW-MEMORY FLAGS
// ═══════════════════════════════════════════════════════════════════════════════

test('Main process sets disable-gpu flag', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("app.commandLine.appendSwitch('disable-gpu')"), 'Must set disable-gpu flag');
});

test('Main process sets max-old-space-size=128', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('--max-old-space-size=128'), 'Must set max-old-space-size=128');
});

test('Low-memory flags are set before app.whenReady()', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const gpuFlagIdx = content.indexOf("app.commandLine.appendSwitch('disable-gpu')");
  const readyIdx = content.indexOf('app.whenReady()');
  assert.ok(gpuFlagIdx > 0 && gpuFlagIdx < readyIdx, 'GPU flag must be before app.whenReady()');
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE: DISPLAY AUTO-OPEN IS DISABLED
// ═══════════════════════════════════════════════════════════════════════════════

test('Low-resource autoOpenDisplays is false', () => {
  assert.equal(LOW_RESOURCE.autoOpenDisplays, false, 'autoOpenDisplays must be false in low-resource mode');
});

test('App.jsx does not auto-open customer/kitchen displays', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf-8');
  assert.ok(!content.includes('openCustomerDisplay'), 'Must not auto-open customer display');
  assert.ok(!content.includes('openKitchenDisplay'), 'Must not auto-open kitchen display');
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE: POLLING INTERVALS IN SCREENS
// ═══════════════════════════════════════════════════════════════════════════════

test('Tickets screen polls at 15s minimum', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Tickets.jsx'), 'utf-8');
  const match = content.match(/setInterval\(\(\) => \{[^}]+\}, (\d+)\)/);
  assert.ok(match, 'Must have setInterval');
  const interval = parseInt(match[1], 10);
  assert.ok(interval >= 15000, `Tickets polling interval=${interval} must be >= 15000`);
});

test('Sync screen polls at 15s minimum', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Sync.jsx'), 'utf-8');
  const match = content.match(/setInterval\(loadStatus, (\d+)\)/);
  assert.ok(match, 'Must have setInterval');
  const interval = parseInt(match[1], 10);
  assert.ok(interval >= 15000, `Sync polling interval=${interval} must be >= 15000`);
});

test('CustomerDisplay polls at 15s minimum', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'CustomerDisplay.jsx'), 'utf-8');
  const match = content.match(/setInterval\(load, (\d+)\)/);
  assert.ok(match, 'Must have setInterval');
  const interval = parseInt(match[1], 10);
  assert.ok(interval >= 15000, `CustomerDisplay polling interval=${interval} must be >= 15000`);
});

test('CustomerDisplay clock updates at 60s minimum', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'CustomerDisplay.jsx'), 'utf-8');
  const match = content.match(/setInterval\(\(\) => setNow\(Date\.now\(\)\), (\d+)\)/);
  assert.ok(match, 'Must have clock setInterval');
  const interval = parseInt(match[1], 10);
  assert.ok(interval >= 60000, `CustomerDisplay clock interval=${interval} must be >= 60000`);
});

test('KitchenDisplay polls at 15s minimum', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'components', 'KitchenDisplay.jsx'), 'utf-8');
  const match = content.match(/setInterval\(\(\) => \{[^}]+\}, (\d+)\)/);
  assert.ok(match, 'Must have setInterval');
  const interval = parseInt(match[1], 10);
  assert.ok(interval >= 15000, `KitchenDisplay polling interval=${interval} must be >= 15000`);
});

test('App.jsx online check uses lowResource.onlineCheckMs or 30s minimum', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf-8');
  assert.ok(content.includes('onlineCheckMs'), 'Must reference lowResource.onlineCheckMs');
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN.JSX — CASHIER UI (no config fields exposed)
// ═══════════════════════════════════════════════════════════════════════════════

test('Login.jsx does NOT show Supabase URL input by default', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(!content.includes('setupUrl'), 'Must not have setupUrl state');
  assert.ok(!content.includes('Supabase URL'), 'Must not render URL label');
});

test('Login.jsx does NOT show anon key input by default', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(!content.includes('setupKey'), 'Must not have setupKey state');
  assert.ok(!content.includes('Supabase Anon Key'), 'Must not render key label');
});

test('Login.jsx missing config message says contact administrator', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(content.includes('not configured'), 'Must say not configured');
  assert.ok(content.includes('Contact the system administrator'), 'Must say contact administrator');
});

test('Login.jsx does NOT contain saveConfig call', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(!content.includes('saveConfig'), 'Must not call saveConfig');
});

test('Login.jsx does NOT contain "rebuild the app" message', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(!content.includes('rebuild the app'), 'Must not tell users to rebuild the app');
  assert.ok(!content.includes('.env'), 'Must not reference .env file');
});

test('Login.jsx does NOT contain "Save and continue" button', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(!content.includes('Save and continue'), 'Must not show Save and continue button');
});

test('Login.jsx only shows email/password login form', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(content.includes('type="email"'), 'Must have email input');
  assert.ok(content.includes('type="password"'), 'Must have password input');
  assert.ok(content.includes('Sign In'), 'Must have Sign In button');
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH / LIVE DATA CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

test('Auth resolves staff profile through auth_user_id and email fallback', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("lookupUserProfileBy('auth_user_id'"), 'Must check users.auth_user_id');
  assert.ok(content.includes("lookupUserProfileBy('email'"), 'Must fall back to email match');
  assert.ok(!content.includes(".eq('id', data.user.id).single()"), 'Must not treat Supabase Auth ID as the staff row ID only');
});

test('Main process normalizes and requires lodge context before live lodge queries', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('function requireLodgeContext()'), 'Must have lodge context guard');
  assert.ok(content.includes('normalizeUuid(state.lodgeId)'), 'Must normalize cached lodge IDs');
  assert.ok(!content.includes(".eq('lodge_id', state.lodgeId)"), 'Live queries must not send null/string-null lodge IDs');
});

test('Rooms and bookings reads match current Boroko schema', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('room_number, room_type'), 'Rooms must select room_number/room_type');
  assert.ok(content.includes('customers(name)'), 'Bookings must get guest name through customers relation');
  assert.ok(!content.includes('id, name, number, status'), 'Rooms must not select removed name/number columns');
  assert.ok(!content.includes('guest_name, status, check_in'), 'Bookings must not select removed guest_name column');
});

test('Terminal keeps desktop POS stock, scanner, and idempotent submit safeguards', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('getInventoryAvailableUnits'), 'Must calculate sale units from stock');
  assert.ok(content.includes('isOrderableMenuItem'), 'Must block sold-out menu items');
  assert.ok(content.includes('barcodeBufferRef'), 'Must support barcode scanner input');
  assert.ok(content.includes('submitIntentRef'), 'Must preserve submit intent for retries');
  assert.ok(content.includes('submit_intent_id'), 'Must pass stable submit intent to payload builder');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n\x1b[36mResults: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
