import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listLegacyCompanies, selectLegacyCompany, selectTrustedCompany, scopeCompanyRows, mergeCompanyRows } from '../src/main/companyLogin.js';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const normalize = (id) => /^[0-9a-f-]{36}$/.test(String(id)) ? id : null;
test('Actual reference cache paths isolate companies and migrate only the proven original owner', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-company-cache-'));
  t.after(() => {
    if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('legacy-company-cache-')) fs.rmSync(temp, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(temp, 'settings.json'), JSON.stringify({ lodge_id: a }));
  fs.writeFileSync(path.join(temp, 'outlets.json'), JSON.stringify([{ id: 'old-outlet' }]));
  // A fresh session selection must not reassign ownership of old global caches.
  fs.writeFileSync(path.join(temp, 'current-session.json'), JSON.stringify({ lodgeId: b }));
  const source = readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('function referenceCachePath(');
  const end = source.indexOf('function assertCompanyQueueSafe(', start);
  const state = { lodgeId: b, cacheDir: temp };
  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const cachePath = new Function('state', 'normalizeUuid', 'fs', 'path', 'readJsonFile', 'COMPANY_REFERENCE_CACHES', source.slice(start, end) + '; return referenceCachePath;')(state, normalize, fs, path, readJson, new Set(['settings', 'outlets']));
  const companyBPath = cachePath('outlets');
  assert.equal(fs.existsSync(companyBPath), false);
  state.lodgeId = a;
  const companyAPath = cachePath('outlets');
  assert.notEqual(companyAPath, companyBPath);
  assert.deepEqual(readJson(companyAPath), [{ id: 'old-outlet' }]);
  assert.equal(cachePath('sync-queue'), path.join(temp, 'sync-queue.json'));
});
test('Actual login IPC waits for a choice, revalidates access, and resolves exactly that company', async () => {
  const source = readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8');
  const start = source.indexOf("  ipcMain.handle('pos:auth-login'");
  const end = source.indexOf("  ipcMain.handle('pos:auth-restore'", start);
  let handler;
  const calls = [];
  const state = { currentUser: null, lodgeId: null, supabase: {
    auth: { signInWithPassword: async () => ({ data: { user: { id: 'auth' }, session: {} } }) },
    rpc: async (_name, args) => ({ data: args.p_product_id === 'hotel' ? [] : [{ lodge_id: args.p_product_id === 'lodge-camp' ? a : b }] })
  } };
  const deps = {
    ipcMain: { handle: (_name, callback) => { handler = callback; } }, state,
    normalizeEmail: (v) => v, normalizeUuid: normalize, formatAuthLoginError: (e) => e.message,
    listLegacyCompanies, selectLegacyCompany,
    assertCompanyQueueSafe: (id) => calls.push(['queue', id]),
    resolveCurrentUserProfile: async (_user, id) => { calls.push(['profile', id]); return { id: 'staff', lodge_id: id }; },
    requireBorokoSession: (v) => v, issueLegacyBorokoSession: async () => ({ token: 'test' }),
    applySupabaseContext: async () => {}, writeCache: () => {}, saveTrustedSession: () => {},
    publishLegacyPosDeviceHealth: async () => {}
  };
  new Function(...Object.keys(deps), source.slice(start, end))(...Object.values(deps));
  const first = await handler(null, { email: 'owner@example.com', password: 'test' });
  assert.equal(first.code, 'company_selection_required');
  assert.equal(state.currentUser, null);
  assert.equal(calls.length, 0);
  await assert.rejects(handler(null, { email: 'owner@example.com', password: 'test', lodgeId: 'foreign' }), /valid company/);
  assert.equal(calls.length, 0);
  const selected = await handler(null, { email: 'owner@example.com', password: 'test', lodgeId: b });
  assert.equal(selected.lodgeId, b);
  assert.deepEqual(calls, [['queue', b], ['profile', b]]);
  await assert.rejects(handler(null, { email: 'owner@example.com', password: 'test', lodgeId: a }), /Sign out/);
});
test('Company cache reads exclude foreign rows and writes preserve their financial records', () => {
  const original = [{ id: 'a', lodge_id: a }, { id: 'b', lodge_id: b }, { id: 'legacy' }];
  assert.deepEqual(scopeCompanyRows(original, b, a).map((row) => row.id), ['b']);
  assert.deepEqual(scopeCompanyRows(original, a, a).map((row) => row.id), ['a', 'legacy']);
  const next = mergeCompanyRows(original, [{ id: 'replacement' }], b, a);
  assert.deepEqual(next.map((row) => row.id), ['a', 'legacy', 'replacement']);
  assert.equal(next[2].lodge_id, b);
  assert.throws(() => mergeCompanyRows(original, [{ lodge_id: a }], b, a), /another company/);
});
test('Legacy lists memberships across lodge, hotel and Bar without issuing a session', async () => {
  const calls = [];
  const companies = await listLegacyCompanies({ rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: args.p_product_id === 'hotel' ? [] : [{ lodge_id: args.p_product_id === 'lodge-camp' ? a : b, lodge_display_name: args.p_product_id }] };
  } }, normalize);
  assert.equal(companies.length, 2);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([name]) => name === 'list_desktop_product_memberships'));
  assert.equal(selectLegacyCompany(companies, null, normalize).code, 'company_selection_required');
  assert.equal(selectLegacyCompany(companies, b, normalize).lodgeId, b);
  assert.throws(() => selectLegacyCompany(companies, '00000000-0000-4000-8000-000000000003', normalize), /does not have access/);
  assert.throws(() => selectLegacyCompany(companies, 'invalid', normalize), /valid company/);
});
test('Membership lookup fails closed on any missing or failed product response', async () => {
  await assert.rejects(listLegacyCompanies({ rpc: async () => ({ error: { message: 'offline' } }) }, normalize), /unavailable/);
  await assert.rejects(listLegacyCompanies({ rpc: async () => ({ data: {} }) }, normalize), /invalid/);
  assert.throws(() => selectLegacyCompany([], null, normalize), /no company/);
  assert.equal(selectLegacyCompany([{ lodge_id: a }], null, normalize).lodgeId, a);
});
test('Offline choices require valid password and scope, hide secrets, and reject expired sessions', () => {
  const now = Date.now();
  const sessions = [a, b].map((id) => ({ lodge_id: id, lodge_name: id === a ? 'Lodge' : 'Bar', email: 'owner@example.com', createdAt: new Date(now).toISOString(), offline_password_hash: 'hash', session_token: 'secret' }));
  const verify = (password, hash) => password === 'correct' && hash === 'hash';
  assert.equal(selectTrustedCompany(sessions, 'owner@example.com', 'wrong', null, verify, now).code, 'wrong_password');
  const selection = selectTrustedCompany(sessions, 'owner@example.com', 'correct', null, verify, now);
  assert.equal(selection.code, 'company_selection_required');
  assert.equal(selection.memberships.length, 2);
  assert.ok(!JSON.stringify(selection).includes('secret'));
  assert.equal(selectTrustedCompany(sessions, 'owner@example.com', 'correct', b, verify, now).session.lodge_id, b);
  assert.equal(selectTrustedCompany(sessions, 'owner@example.com', 'correct', 'foreign', verify, now).code, 'no_session');
  assert.equal(selectTrustedCompany(sessions.map((s) => ({ ...s, createdAt: 'invalid' })), 'owner@example.com', 'correct', null, verify, now).code, 'no_session');
  assert.equal(selectTrustedCompany(sessions, 'owner@example.com', 'correct', null, verify, now + 15 * 86400000).code, 'no_session');
});
