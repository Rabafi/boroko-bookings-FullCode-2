import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importDomain, importState, makeTempCacheDir } from './helpers/domain-test-setup.mjs';

const { state } = await importState();
const pos = await importDomain('pos.js');
const finance = await importDomain('finance.js');
const cache = await importDomain('cacheStore.js');
const refresh = await importDomain('cacheRefresh.js');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

function isolate(t) {
  const keys = ['cacheDir', 'lodgeId', 'supabase', 'currentUser', 'isOnline', 'backendSession', 'replayAuthReady'];
  const previous = Object.fromEntries(keys.map(key => [key, state[key]]));
  const dirA = makeTempCacheDir('bar-scope-a');
  const dirB = makeTempCacheDir('bar-scope-b');
  Object.assign(state, { cacheDir: dirA, lodgeId: A, isOnline: true, currentUser: { id: 'operator-a', lodge_id: A } });
  t.after(() => { Object.assign(state, previous); for (const dir of [dirA, dirB]) fs.rmSync(dir, { recursive: true, force: true }); });
  return { dirA, dirB, switchToB(client) { Object.assign(state, { cacheDir: dirB, lodgeId: B, supabase: client, currentUser: { id: 'operator-b', lodge_id: B } }); } };
}

test('a previous business menu cannot seed the new business cache or start its fingerprint read', async t => {
  const scope = isolate(t);
  const pending = deferred();
  state.supabase = { rpc: () => pending.promise };
  const oldRead = pos.getPosMenuItems();
  let newCalls = 0;
  scope.switchToB({ rpc: async () => { newCalls++; return { data: { success: true, item_count: 1 }, error: null }; } });
  pending.resolve({ data: [{ id: 'old-product', lodge_id: A }], error: null });
  await assert.rejects(oldRead, /business|session.*changed/i);
  assert.equal(newCalls, 0);
  assert.deepEqual(cache.readCache('pos-menu-items'), []);
  assert.deepEqual(cache.readCache('pos-menu-verification'), []);
});

test('new business catalogue requests do not share an old business in-flight read', async t => {
  const scope = isolate(t);
  const pending = deferred();
  state.supabase = { rpc: () => pending.promise };
  const oldRead = pos.getPosMenuItems();
  const oldResult = oldRead.catch(error => error);
  let calls = 0;
  scope.switchToB({ rpc: async name => { calls++; return { data: name.includes('fingerprint') ? { success: true, item_count: 0 } : [], error: null }; } });
  const newRead = pos.getPosMenuItems();
  pending.resolve({ data: [{ id: 'old-product', lodge_id: A }], error: null });
  assert.deepEqual(await newRead, []);
  assert.equal(calls, 2);
  assert.match((await oldResult).message, /business|session.*changed/i);
});

test('an old reconciliation denial is unavailable without creating a new business critical error', async t => {
  const scope = isolate(t);
  const pending = deferred();
  state.supabase = { rpc: () => pending.promise };
  const read = finance.getFinancialReconciliation();
  scope.switchToB({ rpc: async () => { throw new Error('Unexpected new business call'); } });
  pending.resolve({ data: null, error: { code: '42501', message: 'Access denied for this lodge.' } });
  const result = await read;
  assert.equal(result.unavailable, true);
  assert.match(result.message, /business|session.*changed/i);
  assert.deepEqual(cache.readCache('critical-errors'), []);
});

test('a fingerprint finishing after sign-out cannot update the catalogue even in the same lodge', async t => {
  isolate(t);
  const pending = deferred();
  const started = deferred();
  state.supabase = { rpc: async name => {
    if (name.includes('fingerprint')) { started.resolve(); return pending.promise; }
    return { data: [{ id: 'product', lodge_id: A }], error: null };
  } };
  const read = pos.getPosMenuItems();
  await started.promise;
  state.currentUser = null;
  pending.resolve({ data: { success: true, item_count: 1 }, error: null });
  await assert.rejects(read, /business|session.*changed/i);
  assert.deepEqual(cache.readCache('pos-menu-items'), []);
});

test('outlet responses finishing after a business switch do not populate the new cache', async t => {
  const scope = isolate(t);
  const pending = deferred();
  const query = { select() { return this; }, eq() { return this; }, order() { return pending.promise; } };
  state.supabase = { from: () => query };
  const read = pos.getOutlets();
  scope.switchToB({});
  pending.resolve({ data: [{ id: 'outlet-a', name: 'Old Bar' }], error: null });
  await assert.rejects(read, /business|session.*changed/i);
  assert.deepEqual(cache.readCache('outlets'), []);
});

test('late stock readiness never confirms the newly selected business stock', async t => {
  const scope = isolate(t);
  const pending = deferred();
  state.supabase = { rpc: () => pending.promise };
  const read = pos.getMenuStockReadiness();
  scope.switchToB({});
  pending.resolve({ data: { success: true, rows: [{ id: 'old-product' }] }, error: null });
  const result = await read;
  assert.equal(result.success, false);
  assert.match(result.error, /business|session.*changed/i);
  assert.equal(result.rows, undefined);
});

test('a late rejected stock request reports context change instead of the old business denial', async t => {
  const scope = isolate(t);
  const pending = deferred();
  state.supabase = { rpc: () => pending.promise };
  const read = pos.getMenuStockReadiness();
  scope.switchToB({});
  pending.reject(new Error('Access denied for this lodge.'));
  const result = await read;
  assert.equal(result.success, false);
  assert.equal(result.code, 'business_context_changed');
  assert.match(result.error, /business|session.*changed/i);
});

test('startup validation waits for a business staff session instead of recording predictable denials', async t => {
  isolate(t);
  let calls = 0;
  state.supabase = { rpc: async () => { calls++; throw new Error('Must not call without a business session'); } };
  state.backendSession = null;
  assert.equal((await finance.runScheduledFinancialValidation('startup')).skipped, true);
  state.backendSession = { token: 'test-business-session' };
  state.currentUser = { id: 'master', isMasterAdmin: true };
  assert.equal((await finance.runScheduledFinancialValidation('startup')).skipped, true);
  assert.equal(calls, 0);
  assert.deepEqual(cache.readCache('critical-errors'), []);
});

test('background menu refresh cannot overwrite a new business catalogue', async t => {
  const scope = isolate(t);
  const pending = deferred();
  state.replayAuthReady = true;
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return pending.promise; } };
  state.supabase = { from: () => query };
  const read = refresh.refreshCache('pos-menu-items');
  scope.switchToB({});
  pending.resolve({ data: [{ id: 'old-product', lodge_id: A }], error: null });
  await read;
  assert.deepEqual(cache.readCache('pos-menu-items'), []);
});

test('post-sync refresh stops at a profile switch without scheduling old work for the new business', async t => {
  const scope = isolate(t);
  const pending = deferred();
  state.replayAuthReady = true;
  const initialTimer = state.syncRefreshRetryTimer;
  const initialStatus = structuredClone(state.syncRefreshState);
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return pending.promise; } };
  state.supabase = { from: () => query };
  const read = refresh.refreshCachesAfterSync('pos-menu-items', 'customers');
  let newCalls = 0;
  scope.switchToB({ from: () => { newCalls++; throw new Error('Old refresh must stop'); } });
  pending.resolve({ data: null, error: { message: 'Access denied for this lodge.' } });
  await read;
  assert.equal(newCalls, 0);
  assert.equal(state.syncRefreshRetryTimer, initialTimer);
  assert.deepEqual(state.syncRefreshState, initialStatus);
});

test('initial actor publication keeps hydration on the same authenticated client working', async t => {
  isolate(t);
  const pending = deferred();
  state.currentUser = null;
  state.backendSession = { token: 'test-business-session' };
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return pending.promise; } };
  state.supabase = { from: () => query };
  const read = refresh.refreshCache('pos-menu-items');
  state.currentUser = { id: 'operator-a', lodge_id: A };
  pending.resolve({ data: [{ id: 'current-product', lodge_id: A }], error: null });
  await read;
  assert.deepEqual(cache.readCache('pos-menu-items'), [{ id: 'current-product', lodge_id: A }]);
});
