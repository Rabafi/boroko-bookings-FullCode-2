import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { installLegacyBarLocalIpcFence, LegacyBarLocalRuntime } from '../src/main/bar-local/runtime.js';

const identity = {
  authority_id: 'a1000000-0000-4000-8000-000000000001',
  authority_epoch: 1,
  business_id: 'b1000000-0000-4000-8000-000000000001',
  outlet_id: 'c1000000-0000-4000-8000-000000000001',
  device_id: 'd1000000-0000-4000-8000-000000000001',
  owner_staff_id: 'f1000000-0000-4000-8000-000000000001',
  device_token: 'legacy-paired-device-token-value-0123456789'
};

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(Buffer.from(`secret:${value}`, 'utf8').toString('base64'), 'utf8'),
    decryptString: (value) => Buffer.from(value.toString('utf8'), 'base64').toString('utf8').replace(/^secret:/, '')
  };
}

test('Legacy fresh workspace defers cloud, remembers explicit cloud choice, and refuses pairing over saved cloud data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-choice-'));
  try {
    const runtime = new LegacyBarLocalRuntime({ userDataPath: dir, safeStorage: fakeSafeStorage() });
    assert.equal(runtime.status().workspace_choice_required, true);
    assert.equal(runtime.status().has_saved_cloud_business, false);
    assert.equal(runtime.selectCloudWorkspace().restart_required, true);
    assert.equal(runtime.status().workspace_choice_required, true, 'choice applies only to a fresh process');
    runtime.close();
    const next = new LegacyBarLocalRuntime({ userDataPath: dir, safeStorage: fakeSafeStorage() });
    assert.equal(next.status().workspace_choice_required, false);
    await assert.rejects(next.pairDevice({}), { code: 'CLOUD_WORKSPACE_ACTIVE' });
    writeFileSync(join(dir,'pos-config.json'), '{broken');
    assert.equal(next.status().has_saved_cloud_business, true);
    await assert.rejects(next.pairDevice({}), { code: 'CLOUD_TRANSITION_REQUIRED' });
    next.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Legacy local authority fences cloud IPC and direct database channels while cloud mode keeps its existing handler path', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, listener) => handlers.set(channel, listener) };
  const runtimeState = { authority_mode: 'cloud' };
  installLegacyBarLocalIpcFence(ipcMain, { status: () => runtimeState });
  let cloudCalls = 0;
  ipcMain.handle('pos:create-order', async () => { cloudCalls += 1; return { success: true }; });
  ipcMain.handle('db:query', async () => { cloudCalls += 1; return { rows: [] }; });
  ipcMain.handle('supabase:rpc', async () => { cloudCalls += 1; return { data: null }; });
  ipcMain.handle('pos:bar-local:status', async () => ({ authority_mode: runtimeState.authority_mode }));
  assert.deepEqual(await handlers.get('pos:create-order')({}), { success: true });
  runtimeState.authority_mode = 'bar_local';
  await assert.rejects(handlers.get('pos:create-order')({}), { code: 'LOCAL_WORKSPACE_NOT_ROUTED' });
  await assert.rejects(handlers.get('db:query')({}), { code: 'LOCAL_WORKSPACE_NOT_ROUTED' });
  await assert.rejects(handlers.get('supabase:rpc')({}), { code: 'LOCAL_WORKSPACE_NOT_ROUTED' });
  assert.deepEqual(await handlers.get('pos:bar-local:status')({}), { authority_mode: 'bar_local' });
  assert.equal(cloudCalls, 1);
});

test('Legacy runtime pairs, protects profile/credential and uses local login, queries and journaled commands', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'legacy-bar-local-runtime-'));
  const requests = [];
  const service = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/pairing/complete') {
      response.writeHead(201).end(JSON.stringify({
        ok: true, outcome: 'device_paired', ...identity, server_certificate_fingerprint: null
      }));
    } else if (request.url === '/v1/sessions') {
      response.writeHead(201).end(JSON.stringify({
        ok: true, session_token: 'legacy-session-token-value-1234567890', session_id: 'e1000000-0000-4000-8000-000000000001',
        authority_epoch: identity.authority_epoch, business_id: identity.business_id, outlet_id: identity.outlet_id,
        staff: { id: identity.owner_staff_id, display_name: 'Owner', role: 'owner' }
      }));
    } else if (request.url === '/v1/queries/menu.list') {
      response.writeHead(200).end(JSON.stringify({ ok: true, data: [{ id: 'product-1', name: 'Local Stout' }], complete: true }));
    } else if (request.url.startsWith('/v1/events?')) {
      response.writeHead(200).end(JSON.stringify({ ok: true, events: [], next_cursor: 0, gap_detected: false,
        scope: { business_id: identity.business_id, outlet_id: identity.outlet_id, device_id: identity.device_id } }));
    } else if (request.url === '/v1/commands') {
      response.writeHead(200).end(JSON.stringify({
        ok: true, outcome: 'committed_local', replayed: false, operation_id: body.operation_id,
        receipt: {
          operation_id: body.operation_id, outcome: 'committed_local', authority_id: identity.authority_id,
          authority_epoch: identity.authority_epoch, business_id: identity.business_id, outlet_id: identity.outlet_id,
          device_id: identity.device_id, actor_staff_id: identity.owner_staff_id, commit_sequence: 1,
          business_date: '2026-10-20', server_committed_at: '2026-10-20T10:00:00.000Z', cloud_status: 'integration_disabled'
        }, result: { sale_id: 'sale-1' }
      }));
    } else {
      response.writeHead(404).end(JSON.stringify({ code: 'NOT_FOUND', message: 'No test route.' }));
    }
  });
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
  const { port } = service.address();
  const runtime = new LegacyBarLocalRuntime({ userDataPath, safeStorage: fakeSafeStorage() });
  try {
    const paired = await runtime.pairDevice({
      baseUrl: `http://127.0.0.1:${port}`, pairingCode: '12345678', deviceName: 'Legacy Till 1'
    });
    assert.equal(paired.authority_mode, 'bar_local');
    assert.equal(paired.ready_for_local_session, true);
    assert.equal(Object.hasOwn(paired, 'device_token'), false);
    assert.equal(Object.hasOwn(paired, 'transport'), false);
    assert.equal(JSON.stringify(paired).includes(identity.device_token), false);
    const profileBytes = readFileSync(join(userDataPath, 'bar-local', 'authority.bin'));
    const credentialBytes = readFileSync(join(userDataPath, 'bar-local', 'device-credential.bin'));
    assert.equal(profileBytes.toString('utf8').includes(identity.authority_id), false);
    assert.equal(credentialBytes.toString('utf8').includes(identity.device_token), false);

    const login = await runtime.login(identity.owner_staff_id, '482915');
    assert.equal(login.staff.id, identity.owner_staff_id);
    assert.deepEqual(runtime.getOpenIntents(), []);
    assert.equal(Object.hasOwn(login, 'session_token'), false);
    assert.equal(runtime.status().session_active, true);
    const catalogue = await runtime.query('menu.list', { limit: 20 });
    assert.equal(catalogue.data[0].name, 'Local Stout');
    const events = await runtime.events(0, 200);
    assert.equal(events.gap_detected, false);
    assert.equal(requests.find((item) => item.url.startsWith('/v1/events?')).headers.authorization, 'Bearer legacy-session-token-value-1234567890');
    const sale = await runtime.command('sale.commit', { shift_id: '11111111-1111-4111-8111-111111111111', items: [] });
    assert.equal(sale.receipt.commit_sequence, 1);
    assert.equal(runtime.status().pending_intents, 0);
    assert.equal(requests.find((item) => item.url === '/v1/commands').body.authority_id, identity.authority_id);

    await runtime.logout();
    assert.equal(runtime.status().session_active, false);
    runtime.close();
    const recoveryPath = join(userDataPath, 'bar-local', 'provisioning.bin');
    const committedCredential = JSON.parse(fakeSafeStorage().decryptString(readFileSync(join(userDataPath, 'bar-local', 'device-credential.bin'))));
    writeFileSync(recoveryPath, fakeSafeStorage().encryptString(JSON.stringify({
      kind: 'pairing', request: { deviceToken: 'bld_unrelated_staged_credential_012345678901234567890123456789' }
    })));
    let restored = new LegacyBarLocalRuntime({ userDataPath, safeStorage: fakeSafeStorage() });
    assert.equal(restored.status().authority_mode, 'bar_local');
    assert.equal(restored.status().configured, true);
    assert.equal(restored.status().session_active, false);
    assert.equal(existsSync(recoveryPath), true, 'a different staged credential is preserved for recovery');
    restored.close();
    writeFileSync(recoveryPath, fakeSafeStorage().encryptString(JSON.stringify({
      kind: 'pairing', request: { deviceToken: committedCredential.device_token }
    })));
    restored = new LegacyBarLocalRuntime({ userDataPath, safeStorage: fakeSafeStorage() });
    assert.equal(existsSync(recoveryPath), false, 'startup clears only a stage matching the protected committed device credential');
    restored.close();
  } finally {
    runtime.close();
    await new Promise((resolve) => service.close(resolve));
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('Legacy saved pairing recovery replays the exact staged request after a lost response', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'legacy-bar-local-recovery-'));
  const requests = [];
  let attempt = 0;
  const service = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    attempt += 1;
    if (attempt === 1) { response.destroy(); return; }
    response.setHeader('content-type', 'application/json');
    response.writeHead(201).end(JSON.stringify({
      ok: true, outcome: 'device_paired', ...identity, server_certificate_fingerprint: null
    }));
  });
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
  const { port } = service.address();
  let runtime = new LegacyBarLocalRuntime({ userDataPath, safeStorage: fakeSafeStorage() });
  try {
    await assert.rejects(runtime.pairDevice({
      baseUrl: `http://127.0.0.1:${port}`, pairingCode: '12345678', deviceName: 'Recovery Till'
    }));
    const pending = runtime.status().provisioning_recovery;
    assert.deepEqual(pending, { pending: true, kind: 'pairing', recoverable: true });
    assert.equal(JSON.stringify(runtime.status()).includes('bld_'), false);
    runtime.close();
    runtime = new LegacyBarLocalRuntime({ userDataPath, safeStorage: fakeSafeStorage() });
    assert.deepEqual(runtime.status().provisioning_recovery, pending);
    const result = await runtime.resumeProvisioning();
    assert.equal(result.authority_mode, 'bar_local');
    assert.equal(result.provisioning_recovery, null);
    assert.equal(attempt, 2);
    assert.deepEqual(requests[1], requests[0], 'retry must reuse the original provisioning proof and payload');
    assert.equal(JSON.stringify(result).includes('bld_'), false);
  } finally {
    runtime.close();
    await new Promise((resolve) => service.close(resolve));
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('Legacy pairing UI exposes resume for a saved attempt and hides the new-code form', () => {
  const app = readFileSync(new URL('../src/renderer/src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /Resume saved pairing/);
  assert.match(app, /recovery\?\.pending/);
  assert.match(app, /canPair && !recovery\?\.pending/);
  assert.match(app, /resumeProvisioning\(\)/);
});

test('Legacy runtime keeps malformed committed profiles in a blocked local state', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'legacy-bar-local-runtime-'));
  try {
    const localDir = join(userDataPath, 'bar-local');
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, 'authority.bin'), fakeSafeStorage().encryptString('{bad json'));
    const runtime = new LegacyBarLocalRuntime({
      userDataPath,
      safeStorage: fakeSafeStorage()
    });
    assert.equal(runtime.status().authority_mode, 'bar_local');
    assert.equal(runtime.status().configured, false);
    assert.equal(runtime.status().blocked_reason.code, 'AUTHORITY_CONFIG_INVALID');
    runtime.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('Legacy runtime fences a paired till when the intent journal cannot be read', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'legacy-bar-local-runtime-'));
  try {
    const localDir = join(userDataPath, 'bar-local');
    mkdirSync(localDir, { recursive: true });
    const storage = fakeSafeStorage();
    writeFileSync(join(localDir, 'authority.bin'), storage.encryptString(JSON.stringify({
      authority_mode: 'bar_local',
      base_url: 'http://127.0.0.1:4317',
      certificate_fingerprint: null,
      authority_id: identity.authority_id,
      authority_epoch: identity.authority_epoch,
      business_id: identity.business_id,
      outlet_id: identity.outlet_id,
      device_id: identity.device_id
    })));
    writeFileSync(join(localDir, 'device-credential.bin'), storage.encryptString(JSON.stringify({
      device_id: identity.device_id,
      device_token: identity.device_token
    })));
    const journalBytes = '{"record_version":1,"record_type":"intent"}\n';
    writeFileSync(join(localDir, 'intents.jsonl'), journalBytes);

    const runtime = new LegacyBarLocalRuntime({ userDataPath, safeStorage: storage });
    const status = runtime.status();
    assert.equal(status.authority_mode, 'bar_local');
    assert.equal(status.configured, true);
    assert.equal(status.ready_for_local_session, false);
    assert.equal(status.journal_available, false);
    assert.equal(status.journal_error.code, 'JOURNAL_CORRUPT');
    assert.equal(status.blocked_reason.code, 'JOURNAL_CORRUPT');
    assert.equal(status.pending_intents, null);
    assert.throws(() => runtime.getOpenIntents(), { code: 'JOURNAL_CORRUPT' });
    await assert.rejects(runtime.login(identity.owner_staff_id, '482915'), { code: 'JOURNAL_CORRUPT' });
    await assert.rejects(runtime.pairDevice({ baseUrl: 'http://127.0.0.1:4317', pairingCode: '12345678', deviceName: 'Till' }), {
      code: 'SETUP_ALREADY_COMMISSIONED'
    });
    assert.equal(readFileSync(join(localDir, 'intents.jsonl'), 'utf8'), journalBytes);
    runtime.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('Legacy runtime does not default to cloud when a paired credential has no committed profile', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'legacy-bar-local-runtime-'));
  try {
    const localDir = join(userDataPath, 'bar-local');
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, 'device-credential.bin'), fakeSafeStorage().encryptString(JSON.stringify({
      device_id: identity.device_id,
      device_token: identity.device_token
    })));
    const runtime = new LegacyBarLocalRuntime({ userDataPath, safeStorage: fakeSafeStorage() });
    assert.equal(runtime.status().authority_mode, 'bar_local');
    assert.equal(runtime.status().blocked_reason.code, 'PAIRING_RECOVERY_REQUIRED');
    runtime.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
