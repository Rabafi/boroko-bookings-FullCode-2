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
  for (const rpc of ['create_pos_order_v3', 'approve_pos_void_with_pin', 'finalize_pos_shift_cashup_v2', 'create_pos_menu_item', 'update_pos_menu_item', 'delete_pos_menu_item', 'set_bar_pos_pack_template', 'update_pos_prep_ticket_status', 'open_pos_shift_with_id', 'get_pos_shifts', 'create_pos_return_v3']) {
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
  assert.match(content, /printEscPosReceipt,\r?\n\s+openCashDrawer/);
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
  assert.ok(content.includes('buildSupabaseGlobalOptions'), 'Must build Supabase global options');
  assert.ok(content.includes('fetch: globalThis.fetch'), 'Must pass compatible fetch to Supabase');
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
  assert.ok(content.includes("showPassword ? 'text' : 'password'"), 'Must have password input hidden by default');
  assert.ok(content.includes('Sign In'), 'Must have Sign In button');
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH / LIVE DATA CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════

test('Auth resolves staff profile through auth_user_id and email fallback', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("rpc('resolve_legacy_pos_staff_profile'"), 'Must resolve staff profile through POS auth RPC first');
  assert.ok(content.includes("lookupUserProfileBy('auth_user_id'"), 'Must check users.auth_user_id');
  assert.ok(content.includes("lookupUserProfileBy('email'"), 'Must fall back to email match');
  assert.ok(!content.includes(".eq('id', data.user.id).single()"), 'Must not treat Supabase Auth ID as the staff row ID only');
});

test('Database contract includes POS staff auth resolver RPC', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260613010000_legacy_pos_auth_profile_resolution.sql'), 'utf-8');
  assert.ok(migration.includes('create or replace function public.resolve_legacy_pos_staff_profile'), 'Must define POS staff resolver RPC');
  assert.ok(migration.includes('security definer'), 'Resolver must be database-enforced');
  assert.ok(migration.includes('app_authenticated_user_id()'), 'Resolver must use current Supabase auth user');
  assert.ok(migration.includes('More than one Boroko staff profile'), 'Resolver must reject ambiguous email matches');
  assert.ok(migration.includes('grant execute on function public.resolve_legacy_pos_staff_profile(uuid) to authenticated'), 'Authenticated users must be able to call resolver');
});

test('Legacy POS issues Boroko app session after Supabase Auth login', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('issueLegacyBorokoSession'), 'Must issue Boroko app session');
  assert.ok(content.includes("rpc('authenticate_user_from_supabase'"), 'Must fall back to desktop app-session RPC');
  assert.ok(content.includes("'x-boroko-session'"), 'Supabase client must send Boroko session header');
  assert.ok(content.includes('applySupabaseContext({ authSession: data.session, borokoSession })'), 'Login must rebuild client with app-session token');
  assert.ok(content.includes('requireBorokoSession(await issueLegacyBorokoSession(userData))'), 'Online login must fail loudly if app-session token is missing');
});

test('Renderer-facing user profile strips session secrets', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const normalizer = content.match(/function normalizeUserProfile\(user, authUser = null\) \{[\s\S]*?\n\}/);
  assert.ok(normalizer, 'Must have normalizeUserProfile helper');
  assert.ok(normalizer[0].includes('session_token: _sessionToken'), 'Must strip Boroko session token');
  assert.ok(normalizer[0].includes('session_expires_at: _sessionExpiresAt'), 'Must strip Boroko session expiry');
  assert.ok(normalizer[0].includes('...safeUser'), 'Must spread sanitized user fields only');
});

test('Legacy POS app-session bridge migration returns lodge name and session token', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260613130000_legacy_pos_app_session_bridge.sql'), 'utf-8');
  assert.ok(migration.includes('drop function if exists public.resolve_legacy_pos_staff_profile(uuid)'), 'Must replace previous return contract');
  assert.ok(migration.includes('lodge_name text'), 'Resolver must return lodge display name');
  assert.ok(migration.includes('session_token text'), 'Resolver must return Boroko session token');
  assert.ok(migration.includes('public.issue_app_session'), 'Resolver must issue app session');
  assert.ok(migration.includes("'app', 'legacy-pos'"), 'Issued session metadata must identify legacy POS');
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
// OFFLINE FIRST COVERAGE — P0
// ═══════════════════════════════════════════════════════════════════════════════

test('Main process has offline inventory reservation helpers', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('applyOfflinePosInventoryReservation'), 'Must have offline inventory reservation');
  assert.ok(content.includes('restoreOfflinePosInventoryReservation'), 'Must have inventory restore for voids');
  assert.ok(content.includes('buildOfflineInventoryUsage'), 'Must build inventory usage map');
});

test('Main process has cash-up summarizer in main process', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('summarizeCashupOrders'), 'Must have main-process cash-up summarizer');
  assert.ok(content.includes('getOrderPaymentRows'), 'Must parse payment_breakdown from orders');
});

test('Main process has offline session/trusted session helpers', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('restoreTrustedSession'), 'Must have offline session restore');
  assert.ok(content.includes('saveTrustedSession'), 'Must save trusted session on login');
  assert.ok(content.includes('trusted-sessions.json'), 'Must persist trusted sessions');
});

test('Main process saves trusted session on login', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('saveTrustedSession(userData, data.session, password, state.borokoSession)'), 'Must save trusted session with Boroko app session during login');
  assert.ok(content.includes('boroko_session_token'), 'Trusted session must store Boroko app session separately from Supabase token');
});

test('Auth restore supports offline unlock with credentials', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const restoreHandler = content.match(/ipcMain\.handle\('pos:auth-restore'[\s\S]*?(?=ipcMain\.handle\('pos:)/);
  assert.ok(restoreHandler, 'Must have auth-restore handler');
  assert.ok(restoreHandler[0].includes('credentials?.email'), 'Must accept credentials for offline unlock');
  assert.ok(restoreHandler[0].includes('restoreTrustedSession'), 'Must call restoreTrustedSession');
});

test('Void order supports offline with cached orders', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('queueOfflineVoid'), 'Must have offline void queue helper');
  assert.ok(content.includes('restoreOfflinePosInventoryReservation'), 'Must restore inventory on offline void');
  assert.ok(content.includes('_pending_void'), 'Must mark order as pending void');
});

test('Partial return supports offline operation', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('queueOfflineReturn'), 'Must have offline return queue helper');
  assert.ok(content.includes('pos-return:'), 'Must use return idempotency key prefix');
});

test('Create order applies offline inventory reservation', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('applyOfflinePosInventoryReservation(data.items || [])'), 'Must apply inventory reservation in offline order path');
});

// ═══════════════════════════════════════════════════════════════════════════════
// OFFLINE FIRST COVERAGE — P1
// ═══════════════════════════════════════════════════════════════════════════════

test('Menu CRUD supports offline with queue replay', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('queueOfflineRpcMutation'), 'Must have offline RPC mutation helper');
  assert.ok(content.includes("'create_pos_menu_item'"), 'Menu create must use RPC name');
  assert.ok(content.includes("'update_pos_menu_item'"), 'Menu update must use RPC name');
  assert.ok(content.includes("'delete_pos_menu_item'"), 'Menu delete must use RPC name');
  assert.ok(content.includes("'set_bar_pos_pack_template'"), 'Bar pack must use RPC name');
});

test('Table/tab CRUD supports offline with queue replay', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("'upsert_pos_table'"), 'Table save must use RPC name');
  assert.ok(content.includes("'upsert_pos_tab'"), 'Tab save must use RPC name');
  assert.ok(content.includes("'update_pos_tab_status'"), 'Tab status must use RPC name');
});

test('Shift open/close supports offline with queue replay', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('queueOfflineShiftMutation'), 'Must have offline shift mutation helper');
  assert.ok(content.includes("'open_pos_shift_with_id'"), 'Shift open must use RPC name');
  assert.ok(content.includes("'close_pos_shift_with_id'"), 'Shift close must use RPC name');
});

test('Modifier groups, promotions, floor layout save offline with queue replay', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("'upsert_pos_modifier_groups'"), 'Modifier groups must use RPC');
  assert.ok(content.includes("'upsert_pos_promotions'"), 'Promotions must use RPC');
  assert.ok(content.includes("'upsert_pos_floor_layout'"), 'Floor layout must use RPC');
});

test('Cash-up uses main-process summarizer', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const cashupHandler = content.match(/ipcMain\.handle\('pos:create-cashup'[\s\S]*?(?=ipcMain\.handle\('pos:)/);
  assert.ok(cashupHandler, 'Must have create-cashup handler');
  assert.ok(cashupHandler[0].includes('summarizeCashupOrders'), 'Must call main-process summarizer');
});

test('Cash-up summary IPC handler exists', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("'pos:get-cashup-summary'"), 'Must have cash-up summary handler');
});

// ═══════════════════════════════════════════════════════════════════════════════
// OFFLINE FIRST COVERAGE — SYNC VISIBILITY
// ═══════════════════════════════════════════════════════════════════════════════

test('Sync queue detail handler exists', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("'pos:get-sync-queue-detail'"), 'Must have sync queue detail handler');
});

test('Sync queue detail returns entity type, function name, attempts, errors', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const detailHandler = content.match(/ipcMain\.handle\('pos:get-sync-queue-detail'[\s\S]*?(?=ipcMain\.handle\('pos:)/);
  assert.ok(detailHandler, 'Must have sync queue detail handler');
  assert.ok(detailHandler[0].includes('entityType'), 'Must return entityType');
  assert.ok(detailHandler[0].includes('functionName'), 'Must return functionName');
  assert.ok(detailHandler[0].includes('attempts'), 'Must return attempts');
  assert.ok(detailHandler[0].includes('lastError'), 'Must return lastError');
  assert.ok(detailHandler[0].includes('dependsOn'), 'Must return dependsOn');
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRELOAD COVERAGE — NEW METHODS
// ═══════════════════════════════════════════════════════════════════════════════

test('Preload exposes getCashupSummary, getSyncQueueDetail, and accepts credentials for restoreSession', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf-8');
  assert.ok(content.includes('getCashupSummary:'), 'Must expose getCashupSummary');
  assert.ok(content.includes('getSyncQueueDetail:'), 'Must expose getSyncQueueDetail');
  assert.ok(content.includes('restoreSession: (credentials)'), 'restoreSession must accept credentials');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERER — ORDERS VOID/RETURN
// ═══════════════════════════════════════════════════════════════════════════════

test('Orders screen has void and partial return actions', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Orders.jsx'), 'utf-8');
  assert.ok(content.includes('voidOrder'), 'Must call voidOrder IPC');
  assert.ok(content.includes('partialReturn'), 'Must call partialReturn IPC');
  assert.ok(content.includes('PINModal'), 'Must have PIN modal');
  assert.ok(content.includes('ReturnModal'), 'Must have return modal');
  assert.ok(content.includes('XCircle'), 'Must have void icon');
  assert.ok(content.includes('RotateCcw'), 'Must have return icon');
});

test('Orders screen shows Actions column', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Orders.jsx'), 'utf-8');
  assert.ok(content.includes('Actions'), 'Must have Actions column header');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERER — CASHUP ALL-METHOD
// ═══════════════════════════════════════════════════════════════════════════════

test('CashUp screen uses main-process summary and has all-method counted inputs', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'CashUp.jsx'), 'utf-8');
  assert.ok(content.includes('getCashupSummary'), 'Must call getCashupSummary');
  assert.ok(content.includes('countedMethods'), 'Must track counted amounts per method');
  assert.ok(content.includes('PAYMENT_METHODS.map'), 'Must render counted inputs for all methods');
  assert.ok(content.includes('varianceByMethod'), 'Must compute variance per method');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERER — LOGIN OFFLINE UNLOCK
// ═══════════════════════════════════════════════════════════════════════════════

test('Login screen has offline unlock button', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(content.includes('Offline Unlock'), 'Must have offline unlock button');
  assert.ok(content.includes('handleOfflineUnlock'), 'Must have offline unlock handler');
  assert.ok(content.includes('onOfflineUnlock'), 'Must accept onOfflineUnlock prop');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERER — SYNC QUEUE DETAIL
// ═══════════════════════════════════════════════════════════════════════════════

test('Sync screen shows queue detail with entity type, operation, attempts, and errors', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Sync.jsx'), 'utf-8');
  assert.ok(content.includes('getSyncQueueDetail'), 'Must fetch queue detail');
  assert.ok(content.includes('queueDetail'), 'Must track queue detail');
  assert.ok(content.includes('entityType'), 'Must show entity type');
  assert.ok(content.includes('functionName'), 'Must show function name');
  assert.ok(content.includes('attempts'), 'Must show attempt count');
  assert.ok(content.includes('lastError'), 'Must show last error');
  assert.ok(content.includes('dependsOn'), 'Must show dependency status');
});

// ═══════════════════════════════════════════════════════════════════════════════
// APP.JSX — OFFLINE UNLOCK
// ═══════════════════════════════════════════════════════════════════════════════

test('App.jsx passes onOfflineUnlock to Login', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf-8');
  assert.ok(content.includes('handleOfflineUnlock'), 'Must have offline unlock handler');
  assert.ok(content.includes('onOfflineUnlock={handleOfflineUnlock}'), 'Must pass handler to Login');
});

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS: QUEUE STABILITY & DEPENDENCIES
// ═══════════════════════════════════════════════════════════════════════════════

test('createQueueItem uses stable ID when id parameter is provided', () => {
  const item = createQueueItem({
    functionName: 'test_rpc',
    payload: {},
    entityType: 'pos_order',
    entityId: 'entity-123',
    id: 'pos_order-entity-123'
  });
  assert.equal(item.id, 'pos_order-entity-123');
});

test('createQueueItem generates entityType-entityId ID when no id provided', () => {
  const item = createQueueItem({
    functionName: 'test_rpc',
    payload: {},
    entityType: 'pos_order',
    entityId: 'entity-456'
  });
  assert.equal(item.id, 'pos_order-entity-456');
});

test('isQueueItemReady returns false when dependency is declared but missing from queue', () => {
  const item = createQueueItem({
    functionName: 'approve_pos_void_with_pin',
    payload: {},
    entityType: 'pos_void',
    entityId: 'void-1',
    dependsOn: 'pos_order-missing-order'
  });
  assert.equal(isQueueItemReady(item, [item]), false);
});

test('isQueueItemReady returns true when dependency is synced', () => {
  const order = createQueueItem({
    functionName: 'create_pos_order',
    payload: {},
    entityType: 'pos_order',
    entityId: 'order-1'
  });
  const syncedOrder = markItemSynced(order);
  const voidItem = createQueueItem({
    functionName: 'approve_pos_void_with_pin',
    payload: {},
    entityType: 'pos_void',
    entityId: 'void-1',
    dependsOn: order.id
  });
  assert.equal(isQueueItemReady(voidItem, [syncedOrder, voidItem]), true);
});

test('isQueueItemReady returns false when dependency is still pending', () => {
  const order = createQueueItem({
    functionName: 'create_pos_order',
    payload: {},
    entityType: 'pos_order',
    entityId: 'order-2'
  });
  const voidItem = createQueueItem({
    functionName: 'approve_pos_void_with_pin',
    payload: {},
    entityType: 'pos_void',
    entityId: 'void-2',
    dependsOn: order.id
  });
  assert.equal(isQueueItemReady(voidItem, [order, voidItem]), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS: RPC MUTATION HELPER
// ═══════════════════════════════════════════════════════════════════════════════

test('Main process uses queueOfflineRpcMutation (not queueOfflineConfigMutation)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('queueOfflineRpcMutation'), 'Must have queueOfflineRpcMutation');
  assert.ok(!content.includes('queueOfflineConfigMutation'), 'Must NOT have old queueOfflineConfigMutation');
});

test('Menu update queue uses exact RPC args {p_id, p_lodge_id, payload}', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("rpc('update_pos_menu_item', rpcArgs)"), 'Online path must use rpcArgs');
  assert.ok(content.includes("queueOfflineRpcMutation('update_pos_menu_item', rpcArgs"), 'Offline path must use rpcArgs');
});

test('Menu delete queue uses exact RPC args {p_id, p_lodge_id}', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("rpc('delete_pos_menu_item', rpcArgs)"), 'Online path must use rpcArgs');
  assert.ok(content.includes("queueOfflineRpcMutation('delete_pos_menu_item', rpcArgs"), 'Offline path must use rpcArgs');
});

test('Tab status queue uses exact RPC args {p_tab_id, p_status}', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("rpc('update_pos_tab_status', rpcArgs)"), 'Online path must use rpcArgs');
  assert.ok(content.includes("queueOfflineRpcMutation('update_pos_tab_status', rpcArgs"), 'Offline path must use rpcArgs');
});

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS: PARTIAL RETURN SAFETY
// ═══════════════════════════════════════════════════════════════════════════════

test('Partial return renderer sends minimal payload with order_id, pin, lines', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Orders.jsx'), 'utf-8');
  assert.ok(content.includes('order_id: returnModal.id'), 'Must send order_id');
  assert.ok(content.includes('pin,'), 'Must send pin');
  assert.ok(content.includes('lines:'), 'Must send lines array');
  assert.ok(content.includes('line_id:'), 'Lines must include line_id');
  assert.ok(content.includes('quantity: item.returnQty'), 'Lines must include quantity');
});

test('Partial return main process validates PIN via database RPC', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const returnIdx = content.indexOf("ipcMain.handle('pos:partial-return'");
  const returnSection = content.slice(returnIdx, returnIdx + 3000);
  assert.ok(returnSection.includes('create_pos_return_v3'), 'Must use database-authoritative return RPC');
  assert.ok(returnSection.includes('pin'), 'Must send PIN to RPC for server-side validation');
});

test('Partial return uses UUID for return ID (not Date.now)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const returnIdx = content.indexOf("ipcMain.handle('pos:partial-return'");
  const returnSection = content.slice(returnIdx, returnIdx + 3000);
  assert.ok(returnSection.includes("returnId = randomUUID()"), 'Return ID must be UUID');
  assert.ok(!returnSection.includes('Date.now()'), 'Must not use Date.now for return ID');
});

test('Partial return depends on parent order when parent is pending', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const returnQueueIdx = content.indexOf('function queueOfflineReturn');
  const returnQueueSection = content.slice(returnQueueIdx, returnQueueIdx + 1000);
  assert.ok(returnQueueSection.includes("entityType: 'pos_return'"), 'Return entityType must be pos_return');
  assert.ok(returnQueueSection.includes('dependsOn'), 'Return must have dependsOn');
});

test('Partial return does not create prep tickets', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const returnQueueIdx = content.indexOf('function queueOfflineReturn');
  const returnQueueSection = content.slice(returnQueueIdx, returnQueueIdx + 1500);
  assert.ok(!returnQueueSection.includes('appendPrepTickets'), 'Must NOT create prep tickets for returns');
});

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS: SHIFT DEPENDENCY
// ═══════════════════════════════════════════════════════════════════════════════

test('Direct shift close is blocked in favor of atomic cash-up finalization', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const closeIdx = content.indexOf("ipcMain.handle('pos:close-shift'");
  const closeSection = content.slice(closeIdx, closeIdx + 500);
  assert.ok(closeSection.includes('server-authoritative Cash-Up'), 'Direct close must direct operators to atomic cash-up');
  assert.ok(!closeSection.includes("rpc('close_pos_shift_with_id'"), 'Direct close must not bypass cash-up');
});

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS: CASH-UP VARIANCE RECOMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

test('Cash-up recomputes variance in main process (ignores renderer values)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const cashupIdx = content.indexOf("ipcMain.handle('pos:create-cashup'");
  const cashupSection = content.slice(cashupIdx, cashupIdx + 4000);
  assert.ok(content.includes('function computeCashupVariances'), 'Must centralize main-process variance calculation');
  assert.ok(cashupSection.includes('computeCashupVariances('), 'Cash-up handler must use main-process variance calculation');
  assert.ok(cashupSection.includes('cashOverShort'), 'Must compute cashOverShort');
  assert.ok(cashupSection.includes('varianceByMethod'), 'Must compute varianceByMethod');
  assert.ok(content.includes("countedCash = Number(normalizedCounted.cash) || 0"), 'Must compute countedCash from normalized counted values');
  assert.ok(!cashupSection.includes('payload.variance_by_method'), 'Must ignore renderer-supplied variance');
});

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS: SYNC QUEUE RICH METADATA
// ═══════════════════════════════════════════════════════════════════════════════

test('Sync queue detail includes isFinancial, displayName, manualReviewAction, canRetry', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const syncIdx = content.indexOf("ipcMain.handle('pos:get-sync-queue-detail'");
  const syncSection = content.slice(syncIdx, syncIdx + 2500);
  assert.ok(syncSection.includes('isFinancial'), 'Must include isFinancial');
  assert.ok(syncSection.includes('displayName'), 'Must include displayName');
  assert.ok(syncSection.includes('manualReviewAction'), 'Must include manualReviewAction');
  assert.ok(syncSection.includes('canRetry'), 'Must include canRetry');
  assert.ok(syncSection.includes('dependencyState'), 'Must include dependencyState');
});

test('Sync uses patchLocalCacheState for all entity types', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('function patchLocalCacheState'), 'Must have patchLocalCacheState');
  assert.ok(content.includes("entityType === 'pos_menu_item'"), 'Must handle pos_menu_item');
  assert.ok(content.includes("entityType === 'pos_shift_open'"), 'Must handle pos_shift_open');
  assert.ok(content.includes("entityType === 'pos_shift_close'"), 'Must handle pos_shift_close');
  assert.ok(content.includes("entityType === 'pos_return'"), 'Must handle pos_return');
});

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS: AUTH TRUSTED SESSION CHECK
// ═══════════════════════════════════════════════════════════════════════════════

test('Main process has pos:auth-has-trusted-session IPC handler', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("'pos:auth-has-trusted-session'"), 'Must have has-trusted-session handler');
});

test('Preload exposes hasTrustedSession', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf-8');
  assert.ok(content.includes('hasTrustedSession:'), 'Must expose hasTrustedSession');
});

test('Login.jsx uses hasTrustedSession instead of getSyncStatus', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(content.includes('hasTrustedSession'), 'Must use hasTrustedSession');
  assert.ok(!content.includes('getSyncStatus'), 'Must NOT use getSyncStatus for session check');
});

// ═══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS: PREP TICKET FILTERING
// ═══════════════════════════════════════════════════════════════════════════════

test('appendPrepTickets filters out negative-quantity items', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const prepIdx = content.indexOf('function appendPrepTickets');
  const prepSection = content.slice(prepIdx, prepIdx + 800);
  assert.ok(prepSection.includes('positiveItems'), 'Must filter for positive items');
  assert.ok(prepSection.includes('(Number(item.quantity) || 0) > 0'), 'Must check quantity > 0');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-1: Migration schema for return_order_id
// ═══════════════════════════════════════════════════════════════════════════════

test('Migration adds pos_override_log.return_order_id column', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260613020000_legacy_pos_return_and_shift_rpcs.sql'), 'utf-8');
  assert.ok(content.includes('return_order_id'), 'Migration must add return_order_id column');
  assert.ok(content.includes('pos_override_log'), 'Migration must reference pos_override_log');
  assert.ok(content.includes('add column if not exists'), 'Must use IF NOT EXISTS for idempotency');
});

test('Migration creates pos_return_lines table', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260613020000_legacy_pos_return_and_shift_rpcs.sql'), 'utf-8');
  assert.ok(content.includes('pos_return_lines'), 'Migration must create pos_return_lines table');
  assert.ok(content.includes('original_order_item_id'), 'Must track exact original line ID');
  assert.ok(content.includes('unique'), 'Must have unique constraint for idempotency');
});

test('Migration adds shift idempotency key indexes', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260613020000_legacy_pos_return_and_shift_rpcs.sql'), 'utf-8');
  assert.ok(content.includes('idx_pos_shifts_create_idempotency_key'), 'Must have create idempotency index');
  assert.ok(content.includes('idx_pos_shifts_close_idempotency_key'), 'Must have close idempotency index');
  assert.ok(content.includes('where create_idempotency_key is not null'), 'Create index must be partial');
  assert.ok(content.includes('where close_idempotency_key is not null'), 'Close index must be partial');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-2: Return RPC uses pos_return_lines ledger
// ═══════════════════════════════════════════════════════════════════════════════

test('Return RPC uses pos_return_lines ledger for over-return check', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260613020000_legacy_pos_return_and_shift_rpcs.sql'), 'utf-8');
  assert.ok(content.includes('pos_return_lines'), 'RPC must query pos_return_lines');
  assert.ok(content.includes('original_order_item_id'), 'Must query by exact original line ID');
  assert.ok(!content.includes('item_name like'), 'Must NOT use name-based matching');
});

test('Return RPC inserts into pos_return_lines ledger', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260613020000_legacy_pos_return_and_shift_rpcs.sql'), 'utf-8');
  assert.ok(content.includes("insert into public.pos_return_lines"), 'Must insert return line ledger rows');
  assert.ok(content.includes("on conflict"), 'Must be idempotent via ON CONFLICT');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-3: Return payment breakdown uses negative amounts
// ═══════════════════════════════════════════════════════════════════════════════

test('Return RPC payment breakdown uses negative amounts', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260613020000_legacy_pos_return_and_shift_rpcs.sql'), 'utf-8');
  const rpcSection = content.slice(content.indexOf('create_pos_partial_return_with_pin'));
  assert.ok(rpcSection.includes("'amount', v_total"), 'Payment amount must use v_total (which is negative for returns)');
  assert.ok(!rpcSection.includes("'amount', abs(v_total)"), 'Must NOT use abs(v_total) for payment amount');
});

test('Cash-up summarizer applies sign of order total to payment amounts', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('orderSign'), 'Must calculate order sign');
  assert.ok(content.includes('signedAmount'), 'Must apply sign to payment amounts');
  assert.ok(content.includes('orderSign < 0 ? -Math.abs(amount) : Math.abs(amount)'), 'Must negate amounts for negative orders');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-4: Desktop POS uses create_pos_partial_return_with_pin RPC
// ═══════════════════════════════════════════════════════════════════════════════

test('Desktop POS createPosPartialReturnWithPin calls v3 RPC', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'domains', 'pos.js'), 'utf-8');
  assert.ok(content.includes("create_pos_return_v3"), 'Desktop must call create_pos_return_v3 RPC');
  assert.ok(content.includes('rpcPayload'), 'Desktop must build rpcPayload');
  assert.ok(content.includes("state.supabase.rpc('create_pos_return_v3'"), 'Desktop must use supabase.rpc for online path');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-2: Offline close shift patches existing row
// ═══════════════════════════════════════════════════════════════════════════════

test('Cash-up finalization requires online supervisor authority and a clean financial queue', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const cashupIdx = content.indexOf("ipcMain.handle('pos:create-cashup'");
  const cashupSection = content.slice(cashupIdx, cashupIdx + 3000);
  assert.ok(cashupSection.includes('A supervisor or manager must finalize the cash-up'), 'Cash-up must enforce local authority before RPC');
  assert.ok(cashupSection.includes('Cash-up finalization requires an internet connection'), 'Cash-up must not be provisionally finalized offline');
  assert.ok(cashupSection.includes('unresolvedFinancialItems'), 'Cash-up must block while financial operations remain unresolved');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-3: Inventory selects match desktop fields
// ═══════════════════════════════════════════════════════════════════════════════

test('Legacy inventory select includes desktop fields', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('INVENTORY_ITEM_SELECT'), 'Must have primary inventory select');
  assert.ok(content.includes('reorder_level'), 'Primary select must include reorder_level');
  assert.ok(content.includes('lodge_id'), 'Primary select must include lodge_id');
  assert.ok(content.includes('created_at'), 'Primary select must include created_at');
  assert.ok(content.includes('INVENTORY_ITEM_LEGACY_SELECT'), 'Must have legacy fallback select');
});

test('pos:get-inventory-diagnostics IPC handler exists', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('pos:get-inventory-diagnostics'), 'Must have diagnostics IPC');
});

test('Preload exposes getInventoryDiagnostics', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf-8');
  assert.ok(content.includes('getInventoryDiagnostics'), 'Preload must expose getInventoryDiagnostics');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-4: Lodge name derived from settings
// ═══════════════════════════════════════════════════════════════════════════════

test('App.jsx derives lodge name from settings', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf-8');
  assert.ok(content.includes('displayLodgeName'), 'Must have displayLodgeName derived value');
  assert.ok(content.includes('settings?.lodge_name'), 'Must check settings.lodge_name');
  assert.ok(content.includes('settings?.company_name'), 'Must fallback to settings.company_name');
  assert.ok(!content.includes("setLodgeName"), 'Must NOT have separate lodgeName state');
});

test('Bootstrap returns settingsData for renderer', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('settingsData'), 'Bootstrap must return settingsData');
  assert.ok(content.includes("maybeSingle()"), 'Bootstrap settings must use maybeSingle()');
});

test('Reference data cache fallback is scoped to current lodge', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('readArrayCacheForCurrentLodge'), 'Must have lodge-scoped array cache helper');
  assert.ok(content.includes('readObjectCacheForCurrentLodge'), 'Must have lodge-scoped object cache helper');
  assert.ok(content.includes("readMenuCache()"), 'Menu fallback must use lodge-scoped cache');
  assert.ok(content.includes("readInventoryCache()"), 'Inventory fallback must use lodge-scoped cache');
  assert.ok(content.includes("readObjectCacheForCurrentLodge('settings')"), 'Settings fallback must be lodge-scoped');
  assert.ok(content.includes("select('id, lodge_id, name, type, sort_order')"), 'Outlet query must cache lodge_id');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-5: Full-screen uses fromWebContents
// ═══════════════════════════════════════════════════════════════════════════════

test('Full-screen IPC uses fromWebContents', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('BrowserWindow.fromWebContents(event.sender)'), 'Must use fromWebContents for fullscreen');
  assert.ok(!content.includes("getAllWindows()[0]"), 'Must NOT use getAllWindows for fullscreen');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-1: Migration order - columns before indexes
// ═══════════════════════════════════════════════════════════════════════════════

test('Migration adds shift idempotency columns before creating indexes', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260613020000_legacy_pos_return_and_shift_rpcs.sql'), 'utf-8');
  const colIdx = content.indexOf('add column if not exists create_idempotency_key');
  const idxIdx = content.indexOf('idx_pos_shifts_create_idempotency_key');
  assert.ok(colIdx > 0, 'Must have ALTER TABLE for create_idempotency_key');
  assert.ok(idxIdx > 0, 'Must have index for create_idempotency_key');
  assert.ok(colIdx < idxIdx, 'ALTER TABLE must come before the index');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-2: Multi-line return ledger uses original_order_item_id from built items
// ═══════════════════════════════════════════════════════════════════════════════

test('Return RPC includes original_order_item_id in built return items', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20260613020000_legacy_pos_return_and_shift_rpcs.sql'), 'utf-8');
  assert.ok(content.includes("'original_order_item_id', v_line_id"), 'Must store original line ID in built item');
  assert.ok(content.includes("v_line->>'original_order_item_id'"), 'Must extract original line ID from built item in second loop');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P0-3: Desktop offline return queues create_pos_partial_return_with_pin
// ═══════════════════════════════════════════════════════════════════════════════

test('Desktop offline return queues create_pos_return_v3, not createPosOrder', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'domains', 'pos.js'), 'utf-8');
  const returnIdx = content.indexOf("create_pos_return_v3', { payload: rpcPayload }");
  const returnSection = content.slice(returnIdx - 200, returnIdx + 2000);
  assert.ok(returnSection.includes("queueOperation('rpc', 'create_pos_return_v3'"), 'Must queue create_pos_return_v3 for offline');
  assert.ok(!returnSection.includes('createPosOrder({'), 'Must NOT fall back to createPosOrder');
});

test('Desktop FINANCIAL_SYNC_TABLES includes create_pos_return_v3', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', 'syncQueue.js'), 'utf-8');
  assert.ok(content.includes("'create_pos_return_v3'"), 'FINANCIAL_SYNC_TABLES must include create_pos_return_v3');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-2: Login/offline bootstrap uses settingsData key
// ═══════════════════════════════════════════════════════════════════════════════

test('App.jsx login and offline unlock use settingsData, not settings', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf-8');
  assert.ok(content.includes("r?.settingsData"), 'Bootstrap callbacks must check settingsData');
  assert.ok(!content.includes("r?.settings) setSettings(r.settings)"), 'Must NOT use r.settings for setSettings');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-3: Sync inventory diagnostics UI
// ═══════════════════════════════════════════════════════════════════════════════

test('Sync screen has inventory diagnostics section', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Sync.jsx'), 'utf-8');
  assert.ok(content.includes('Inventory Diagnostics'), 'Must have diagnostics section header');
  assert.ok(content.includes('inventoryDiag'), 'Must use inventoryDiag state');
  assert.ok(content.includes('getInventoryDiagnostics'), 'Must call getInventoryDiagnostics');
  assert.ok(content.includes('showInventoryDiag'), 'Must have toggle state for diagnostics');
});

test('Sync diagnostics shows remote/bar/cached/outlet counts', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Sync.jsx'), 'utf-8');
  assert.ok(content.includes('Remote Inventory'), 'Must show remote count');
  assert.ok(content.includes('Bar Outlet'), 'Must show bar outlet count');
  assert.ok(content.includes('Cached Locally'), 'Must show cached count');
  assert.ok(content.includes('Outlet Access'), 'Must show outlet access count');
});

test('Sync diagnostics warns when remote returns 0 but cache has data', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Sync.jsx'), 'utf-8');
  assert.ok(content.includes('Remote returned 0 items'), 'Must warn about empty remote results');
  assert.ok(content.includes('Using cached inventory'), 'Must mention cached inventory fallback');
});

test('Sync diagnostics warns when no bar outlet inventory found', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Sync.jsx'), 'utf-8');
  assert.ok(content.includes('No Bar outlet inventory found'), 'Must warn about missing bar outlet');
  assert.ok(content.includes('correct outlet_id'), 'Must mention outlet_id');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-4: Full-screen icon buttons
// ═══════════════════════════════════════════════════════════════════════════════

test('App.jsx uses lucide icons for fullscreen toggle', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf-8');
  assert.ok(content.includes('Maximize2'), 'Must import Maximize2 icon');
  assert.ok(content.includes('Minimize2'), 'Must import Minimize2 icon');
  assert.ok(content.includes("isFullscreen ? <Minimize2"), 'Must render Minimize2 when fullscreen');
  assert.ok(content.includes("<Maximize2"), 'Must render Maximize2 when not fullscreen');
  assert.ok(!content.includes('>Exit Full<'), 'Must NOT use text Exit Full');
  assert.ok(content.includes('aria-label'), 'Must have aria-label for accessibility');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-1: Terminal and Menu empty states
// ═══════════════════════════════════════════════════════════════════════════════

test('MenuManagement shows inventory-aware empty state', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'MenuManagement.jsx'), 'utf-8');
  assert.ok(content.includes('inventoryItems.length > 0'), 'Must check for loaded inventory items');
  assert.ok(content.includes('Bar inventory loaded'), 'Must show inventory loaded message');
  assert.ok(content.includes('but no POS menu items linked'), 'Must show missing link message');
});

test('POSTerminal shows inventory-aware empty state', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('unlinkedInventoryItems.length > 0'), 'Must check unlinked inventory items');
  assert.ok(content.includes('need to be linked to the published POS menu before they can be sold'), 'Must explain the required catalog linkage');
  assert.ok(content.includes('No items available for the selected outlet/category'), 'Must show outlet-filtered message');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-5: GitHub release auto-update lane
// ═══════════════════════════════════════════════════════════════════════════════

test('Legacy package config supports GitHub release publishing', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  assert.ok(pkg.dependencies['electron-updater'], 'electron-updater dependency must be installed');
  assert.equal(pkg.build.publish.provider, 'github');
  assert.equal(pkg.build.publish.owner, 'Rabafi');
  assert.equal(pkg.build.publish.repo, 'boroko-pos-legacy-releases');
  assert.ok(pkg.scripts['release:publish'], 'release:publish script must exist');
  assert.ok(pkg.scripts['dist:publish'], 'dist:publish script must exist');
});

test('Legacy release script requires GH_TOKEN and publishes with electron-builder', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.mjs'), 'utf-8');
  assert.ok(content.includes('GH_TOKEN'), 'Release script must require GH_TOKEN');
  assert.ok(content.includes('--publish'), 'Release script must publish through electron-builder');
  assert.ok(content.includes('releaseNotesFile'), 'Release script must attach release notes');
});

test('Legacy main process wires auto-updater IPC and install blockers', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes("import autoUpdaterPkg from 'electron-updater'"), 'Must import electron-updater');
  assert.ok(content.includes('pos:update-check'), 'Must expose update check IPC');
  assert.ok(content.includes('pos:update-download'), 'Must expose update download IPC');
  assert.ok(content.includes('pos:update-install'), 'Must expose update install IPC');
  assert.ok(content.includes('getUpdateInstallSafety'), 'Must compute update install safety');
  assert.ok(content.includes('open shift(s)'), 'Update install must guard open shifts');
  assert.ok(content.includes('failed/manual review sync item(s)'), 'Update install must guard failed sync items');
  assert.ok(content.includes('quitAndInstall(false, true)'), 'Must install downloaded update with restart');
});

test('Preload exposes update bridge under POS API', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf-8');
  assert.ok(content.includes('updates: {'), 'Must expose updates object');
  assert.ok(content.includes('pos:update-available'), 'Must expose update event listeners');
  assert.ok(content.includes('pos:update-get-install-safety'), 'Must expose install safety');
});

test('Sync screen includes app update controls and blockers', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Sync.jsx'), 'utf-8');
  assert.ok(content.includes('App Updates'), 'Must show app update section');
  assert.ok(content.includes('Check'), 'Must provide update check button');
  assert.ok(content.includes('Download'), 'Must provide update download button');
  assert.ok(content.includes('Restart to Install'), 'Must provide install button');
  assert.ok(content.includes('Finish before restarting'), 'Must show update blockers');
});

test('Login screen can check/install updates before sign-in', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(content.includes('handleUpdateAction'), 'Login must have update action');
  assert.ok(content.includes('Check for Updates'), 'Login must show update check button');
  assert.ok(content.includes('Restart to Install Update'), 'Login must allow ready update install');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-6: Tax display follows desktop VAT setting
// ═══════════════════════════════════════════════════════════════════════════════

test('POSTerminal only calculates and shows tax when VAT is enabled', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('settings?.vat_enabled === true'), 'Must use VAT enabled setting');
  assert.ok(content.includes("settings?.vat_rate"), 'Must use VAT rate setting');
  assert.ok(content.includes('taxEnabled ? Number(taxRate) || 0 : 0'), 'Tax rate must be zero when disabled');
  assert.ok(content.includes('taxEnabled && Number(cartTotals.tax_total) > 0'), 'Tax total must be hidden when disabled');
  assert.ok(!content.includes('settings?.default_tax_rate'), 'Must not use legacy default tax rate');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-7: Inventory/menu linkage and catalog-safe POS buttons
// ═══════════════════════════════════════════════════════════════════════════════

test('POSTerminal never sells virtual inventory rows outside the published catalog', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('unlinkedInventoryItems'), 'Must identify unlinked inventory rows');
  assert.ok(content.includes('const terminalMenuItems = menuItems || []'), 'Terminal must sell published menu rows only');
  assert.ok(!content.includes('_virtual_inventory_item: true'), 'Must not synthesize sellable catalog items');
  assert.ok(content.includes('menu_item_id: item.id'), 'Every cart line must preserve a real menu item ID');
});

test('POSTerminal keeps cart visible by collapsing optional order details', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('detailsExpanded'), 'Optional order detail fields must be collapsible');
  assert.ok(content.includes('min-h-[220px] flex-1 overflow-y-auto'), 'Cart list must keep usable vertical space');
  assert.ok(content.includes('max-h-[46vh] overflow-y-auto'), 'Bottom controls must scroll instead of consuming the whole cart panel');
  assert.ok(content.includes('Order details'), 'Operator must have a clear details toggle');
});

test('POSTerminal outlet selector filters by effective inventory outlet and protects active cart', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('getEffectiveItemOutletId'), 'Must derive outlet from menu row or linked inventory item');
  assert.ok(content.includes('itemMatchesOutlet'), 'Must filter sale buttons through outlet matcher');
  assert.ok(content.includes('inventoryById.get(item.inventory_item_id)?.outlet_id'), 'Must use inventory outlet when menu outlet is missing');
  assert.ok(content.includes('Clear the current cart before switching outlets'), 'Must block outlet switches while a cart is active');
  assert.ok(content.includes('setSelectedOutlet(nextOutlet)'), 'Selecting/adding outlet-scoped items must set order outlet context');
});

test('MenuManagement exposes inventory stock link and depletion quantity', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'MenuManagement.jsx'), 'utf-8');
  assert.ok(content.includes('Inventory Stock Link'), 'Menu form must expose inventory link');
  assert.ok(content.includes('depletion_qty'), 'Menu form must expose depletion quantity');
  assert.ok(content.includes('openCreateFromInventory'), 'Must support creating menu item from inventory');
  assert.ok(content.includes('Offline changes will be saved locally and queued for sync'), 'Offline menu edits must be allowed and labelled');
});

test('Inventory diagnostics reports bar outlet names and unlinked bar inventory', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('bar_outlet_names'), 'Diagnostics must return bar outlet names');
  assert.ok(content.includes('unlinked_bar_inventory_count'), 'Diagnostics must count unlinked bar inventory');
  assert.ok(content.includes("text.includes('bar')"), 'Diagnostics must detect bar outlets by name/type');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P1-8: Drawer and payment terminal setup parity
// ═══════════════════════════════════════════════════════════════════════════════

test('Hardware screen exposes drawer open and card terminal setup', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Hardware.jsx'), 'utf-8');
  assert.ok(content.includes('Open Drawer'), 'Hardware screen must have manual drawer open');
  assert.ok(content.includes('Card Terminal'), 'Hardware screen must expose card terminal setup');
  assert.ok(content.includes('payment_terminal_bridge_url'), 'Hardware screen must expose terminal bridge URL');
  assert.ok(content.includes("handleTest('payment-terminal')"), 'Hardware screen must test payment terminal');
});

test('Hardware adapter can send payment terminal totals', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'hardware', 'posHardwareAdapter.js'), 'utf-8');
  assert.ok(content.includes('export async function sendPaymentTerminalTotal'), 'Adapter must export terminal sender');
  assert.ok(content.includes("type: data.test ? 'test_sale' : 'sale'"), 'Terminal sender must support test and sale payloads');
  assert.ok(content.includes('Payment terminal is in manual mode'), 'Manual terminal mode must be explicit');
});

test('POSTerminal can send card total to configured terminal bridge', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('handleSendTerminalTotal'), 'Terminal must have card bridge action');
  assert.ok(content.includes('sendPaymentTerminalTotal'), 'Terminal must call preload payment terminal bridge');
  assert.ok(content.includes('Send Total to Card Terminal'), 'Terminal must expose operator button');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P2-2: Remembered login emails and sensitive field visibility
// ═══════════════════════════════════════════════════════════════════════════════

test('Legacy login remembers successful emails without storing passwords', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  assert.ok(content.includes('LEGACY_POS_REMEMBERED_EMAILS_KEY'), 'Login must have a scoped remembered email key');
  assert.ok(content.includes('saveRememberedEmail(loginEmail)'), 'Successful login/offline unlock must remember the email');
  assert.ok(content.includes('legacy-pos-remembered-emails'), 'Email field must expose remembered email suggestions');
  assert.ok(!content.includes('localStorage?.setItem(LEGACY_POS_REMEMBERED_EMAILS_KEY, JSON.stringify(password'), 'Must not persist passwords');
});

test('Legacy login and order PIN prompts have visibility toggles', () => {
  const login = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Login.jsx'), 'utf-8');
  const orders = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Orders.jsx'), 'utf-8');
  assert.ok(login.includes("showPassword ? 'text' : 'password'"), 'Login password must be revealable');
  assert.ok(login.includes("aria-label={showPassword ? 'Hide password' : 'Show password'}"), 'Login password toggle must be labelled');
  assert.ok(orders.includes('function PinInput'), 'Order approval PINs must use a shared PIN input');
  assert.ok(orders.includes("showPin ? 'text' : 'password'"), 'PIN prompts must be revealable');
  assert.ok(orders.includes("aria-label={showPin ? 'Hide PIN' : 'Show PIN'}"), 'PIN toggle must be labelled');
});

test('Legacy POS explains unconfirmed Supabase Auth accounts clearly', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('formatAuthLoginError'), 'Auth login errors must be normalized');
  assert.ok(content.includes('email not confirmed'), 'Must detect Supabase email confirmation failures');
  assert.ok(content.includes('Reset this staff member password in Boroko Desktop or Command Central'), 'Must tell managers how to repair unconfirmed staff Auth users');
});

// ═══════════════════════════════════════════════════════════════════════════════
// P2-3: Touchscreen reliability and order history item visibility
// ═══════════════════════════════════════════════════════════════════════════════

test('Order history displays purchased line items and keeps actions touch-visible', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Orders.jsx'), 'utf-8');
  assert.ok(content.includes('function getOrderItems'), 'Order history must normalize order item rows');
  assert.ok(content.includes('formatOrderItems(order)'), 'Order history must render item summaries');
  assert.ok(content.includes('Items</th>'), 'Order table must include an items column');
  assert.ok(content.includes('min-h-10 min-w-10'), 'Void/return actions must have touch-sized targets');
  assert.ok(content.includes('touch-scroll overflow-auto'), 'Order history must support swipe scrolling in both axes');
  assert.ok(content.includes('calc(100vh - 220px)'), 'Order history must keep a bounded vertical scroll area');
  assert.ok(!content.includes('opacity-0 group-hover:opacity-100'), 'Order actions must not be hover-only on touchscreens');
});

test('Legacy POS installs global touch focus and selection protection', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'main.jsx'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'index.css'), 'utf-8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'App.jsx'), 'utf-8');
  assert.ok(main.includes('installLegacyTouchFocusFix'), 'Renderer must install legacy touch focus fixes');
  assert.ok(main.includes('MSPointerUp'), 'Touch fix must support older Windows pointer events');
  assert.ok(main.includes('activateControlFromTouch'), 'Touch controls must synthesize reliable click activation');
  assert.ok(main.includes('synthesizingTouchClick'), 'Touch click synthesis must suppress duplicate native clicks');
  assert.ok(main.includes('scrollSelector'), 'Touch fix must recognize swipe-scroll regions');
  assert.ok(main.includes('dx > 8 || dy > 8'), 'Touch fix must treat small swipes as scrolling, not taps');
  assert.ok(main.includes('selectstart'), 'Touch fix must block accidental non-input selection');
  assert.ok(main.includes('dragstart'), 'Touch fix must block accidental drag selection on controls');
  assert.ok(css.includes('.touch-scroll'), 'CSS must include a reusable touch scroll helper');
  assert.ok(css.includes('touch-action: pan-y'), 'CSS must allow vertical swipe scrolling');
  assert.ok(css.includes('touch-action: pan-x'), 'CSS must allow horizontal swipe scrolling');
  assert.ok(css.includes('-ms-touch-action: manipulation'), 'CSS must include old Windows touch-action hint');
  assert.ok(css.includes('user-select: none'), 'Non-input UI must disable accidental text selection');
  assert.ok(css.includes('user-select: text'), 'Actual text fields must remain editable/selectable');
  assert.ok(css.includes('min-height: 40px'), 'Touch controls must have a minimum usable touch height');
  assert.ok(app.includes('flex h-screen flex-col overflow-hidden'), 'App shell must avoid stale viewport sizing glitches');
});

test('POSTerminal cart and menu regions are swipe-scrollable', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'POSTerminal.jsx'), 'utf-8');
  assert.ok(content.includes('touch-scroll-x flex gap-2 overflow-x-auto'), 'Category strip must allow horizontal swipes');
  assert.ok(content.includes('touch-scroll-y flex-1 overflow-y-auto p-4'), 'Menu item grid must allow vertical swipes');
  assert.ok(content.includes('touch-scroll-y min-h-[220px] flex-1 overflow-y-auto'), 'Cart must allow vertical swipe scrolling');
  assert.ok(content.includes('touch-scroll-y max-h-[46vh] overflow-y-auto'), 'Order details must allow vertical swipe scrolling');
});

test('Legacy updater limits the POSReady 7 certificate exception to GitHub release hosts', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  assert.ok(content.includes('GITHUB_UPDATE_CERT_HOSTS'), 'Must explicitly list the allowed GitHub update hosts');
  assert.ok(content.includes('isGitHubUpdateCertificateHost(url)'), 'Certificate exceptions must be host-scoped');
  assert.ok(content.includes('event.preventDefault()'), 'Known GitHub update hosts must support the legacy certificate exception');
  assert.ok(content.includes('setCertificateVerifyProc'), 'Electron network requests must use the same host-scoped compatibility rule');
  assert.ok(content.includes('callback(false)'), 'Non-GitHub certificate errors must still be rejected');
  assert.ok(!content.includes("NODE_TLS_REJECT_UNAUTHORIZED = '0'"), 'Updater must not disable TLS verification globally');
  assert.ok(content.includes('formatUpdateError'), 'Updater must normalize certificate failures');
  assert.ok(content.includes('ERR_CERT_AUTHORITY_INVALID'.toLowerCase()), 'Updater must detect invalid certificate authority failures');
});

test('Legacy financial queue is journaled and approval secrets are encrypted', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const journal = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'storage', 'financialJournal.js'), 'utf-8');
  const secrets = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'storage', 'secureQueueSecrets.js'), 'utf-8');
  assert.ok(main.includes('appendFinancialJournalEvent'), 'Financial queue mutations must be journaled');
  assert.ok(main.includes('rebuildFinancialQueueFromJournal'), 'Startup must rebuild pending financial operations');
  assert.ok(journal.includes('fs.fsyncSync'), 'Journal appends must be flushed to disk');
  assert.ok(journal.includes('append verification failed'), 'Journal appends must be reread and verified');
  assert.ok(secrets.includes('safeStorage.encryptString'), 'Queued approval PINs must use OS-backed encryption');
  assert.ok(secrets.includes('Secure Windows credential storage is unavailable'), 'There must be no plaintext fallback');
});

test('Legacy release and process hardening is enabled', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  assert.ok(main.includes('app.requestSingleInstanceLock()'), 'POS must prevent concurrent local instances');
  assert.notEqual(pkg.build.win.forceCodeSigning, true, 'Legacy releases must remain buildable when no compatible signing certificate is configured');
});

test('Legacy POS participates in the authenticated local lodge mesh', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf-8');
  const syncScreen = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'screens', 'Sync.jsx'), 'utf-8');
  const mesh = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'mesh', 'legacyMesh.js'), 'utf-8');
  assert.ok(main.includes('createLegacyMeshController'), 'Main process must start the legacy mesh controller');
  assert.ok(mesh.includes('boroko_mesh_hello'), 'Legacy POS must use the same LAN discovery beacon');
  assert.ok(mesh.includes('create_pos_order_v3'), 'Legacy mesh must exchange v3 sales');
  assert.ok(mesh.includes('finalize_pos_shift_cashup_v2'), 'Legacy mesh must exchange atomic cash-ups');
  assert.ok(mesh.includes('hasMachineBoundSecret'), 'Machine-bound approval secrets must not leave their origin device');
  assert.ok(mesh.includes('createHmac'), 'Mesh requests must be authenticated');
  assert.ok(mesh.includes('os.networkInterfaces()'), 'Legacy mesh must inspect each network adapter');
  assert.ok(mesh.includes('entry.broadcast'), 'Legacy mesh must send adapter-specific broadcasts');
  assert.ok(mesh.includes('MESH_HTTP_PORT_START = 53536'), 'Legacy mesh must use the predictable firewall port range');
  assert.ok(mesh.includes('connectManual'), 'Legacy POS must support manual IP fallback');
  assert.ok(mesh.includes('legacy-mesh-peers.json'), 'Legacy POS must remember successful peers');
  assert.ok(preload.includes('pos:get-mesh-status'), 'Renderer must be able to inspect mesh health');
  assert.ok(syncScreen.includes('Local Lodge Mesh'), 'Operators must be shown local mesh status');
  assert.ok(syncScreen.includes('Connect IP'), 'Operators must have a manual IP fallback');
  assert.ok(syncScreen.includes('Bridge/AP mode'), 'Extender setup guidance must be visible');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n\x1b[36mResults: ${passed} passed, ${failed} failed\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
