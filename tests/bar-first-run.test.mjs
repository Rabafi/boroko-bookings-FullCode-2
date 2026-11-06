import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTillCoreReads, selectBusinessCrashHistory } from '../src/shared/tillFirstRun.js';

const fulfilled = (value) => ({ status: 'fulfilled', value });
const rejected = (reason) => ({ status: 'rejected', reason });

test('a successful empty catalogue remains empty when a different service fails', () => {
  const error = new Error('Staff service unavailable');
  const result = resolveTillCoreReads([fulfilled([]), rejected(error)]);
  assert.deepEqual(result.menu, []);
  assert.equal(result.serviceError, error);
  assert.ok(resolveTillCoreReads([fulfilled([]), rejected(null)]).serviceError instanceof Error);
});

test('a failed catalogue is never interpreted as empty or masked by a service failure', () => {
  const error = new Error('Access denied for this lodge.');
  assert.throws(() => resolveTillCoreReads([rejected(error), rejected(new Error('other'))]), error);
  assert.throws(() => resolveTillCoreReads([fulfilled({ _available: false, _error: error.message })]), /Access denied/);
  for (const value of [undefined, null, {}, { success: true }]) {
    assert.throws(() => resolveTillCoreReads([fulfilled(value)]), /catalogue could not be verified/);
  }
});

test('products survive an unrelated service failure without allowing that failure to disappear', () => {
  const menu = [{ id: 'product' }];
  const error = new Error('Outlet read failed');
  const result = resolveTillCoreReads([fulfilled(menu), rejected(error), fulfilled({ success: true })]);
  assert.equal(result.menu, menu);
  assert.equal(result.serviceError, error);
  assert.deepEqual(result.values[2], { success: true });
});

test('business crash history filters before limiting and excludes unattributed device history', () => {
  const entries = [{ lodge_id: 'rabafi', id: 1 }, { id: 2 }, { lodge_id: 'other', id: 3 }, { lodge_id: 'rabafi', id: 4 }, { lodge_id: 'other', id: 5 }];
  assert.deepEqual(selectBusinessCrashHistory(entries, 'rabafi', 2).map(x => x.id), [4, 1]);
  assert.deepEqual(selectBusinessCrashHistory(entries, 'new-bar'), []);
  assert.deepEqual(selectBusinessCrashHistory(entries, null), []);
  assert.equal(entries.length, 5, 'history is retained for diagnostics');
});

test('draft creation drops the old actor and replay authority before changing business', () => {
  const source = readFileSync(new URL('../src/main/domains/profiles.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function createDraftProfile()'));
  const switchAt = body.indexOf('setRuntimeActiveProfile(draftLodgeId');
  assert.ok(switchAt > 0);
  for (const statement of ['state.currentUser = null;', 'state.replayAuthReady = false;', 'clearBackendSession();']) {
    const index = body.indexOf(statement);
    assert.ok(index >= 0 && index < switchAt, statement);
  }
});

test('first-run recovery links keep Manage verification and stock failure guards', () => {
  const layout = readFileSync(new URL('../src/renderer/src/components/hospitality-pos/HposLayout.jsx', import.meta.url), 'utf8');
  const terminal = readFileSync(new URL('../src/renderer/src/components/hospitality-pos/HposTerminal.jsx', import.meta.url), 'utf8');
  assert.match(layout, /No PIN yet\? Set up My Staff PIN/);
  assert.match(layout, /navigate\('\/hpos\/my-shift#my-staff-pin'\)/);
  assert.match(layout, /verifyManagerPin\(\{ staff_id: user.id, pin \}\)/);
  assert.match(terminal, /Add your first product/);
  assert.match(terminal, /setMenuLoadFailed\(!catalogueLoaded\)/);
  assert.match(terminal, /\(menuItems.length > 0 \|\| cart.length > 0\) && stockReadiness.status === "failed"/);
});
