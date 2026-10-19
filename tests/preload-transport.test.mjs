import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createPreloadTransport } from '../src/preload/transport.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

// Synthetic receiver-sensitive IpcRenderer stand-in. No real Electron.
function makePort({ invokeImpl, offImpl } = {}) {
  const calls = [];
  const listeners = new Map();
  const port = {
    invoke(channel, ...args) {
      calls.push({ method: 'invoke', channel, args, receiver: this });
      if (invokeImpl) return invokeImpl.call(this, channel, ...args);
      return Promise.resolve(undefined);
    },
    on(channel, listener) {
      calls.push({ method: 'on', channel, listener, receiver: this });
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel).push(listener);
    },
    off(channel, listener) {
      calls.push({ method: 'off', channel, listener, receiver: this });
      if (offImpl) return offImpl.call(this, channel, listener);
      return undefined;
    },
  };
  return { port, calls, listeners };
}

test('invoke keeps channel/arg order, identity and exact promise', () => {
  const sentinel = Promise.resolve({ ok: 1 });
  const { port, calls } = makePort({ invokeImpl: () => sentinel });
  const t = createPreloadTransport(port);
  const nothing = undefined;
  const payload = { nested: [1, { two: 2 }] };
  const envelope = Object.assign(['a', 'b'], { _source: 'test', _complete: true });
  const out = t.invoke('review:probe', null, nothing, payload, envelope);
  assert.equal(out, sentinel, 'invoke must return the exact promise object');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].receiver, port, 'invoke must call the member on the supplied port');
  assert.equal(calls[0].channel, 'review:probe');
  assert.equal(calls[0].args[0], null);
  assert.equal(calls[0].args[1], nothing);
  assert.equal(calls[0].args[2], payload);
  assert.equal(calls[0].args[3], envelope);
  assert.equal(calls[0].args[3]._source, 'test');
  assert.equal(calls[0].args[3]._complete, true);
});

test('invoke propagates synchronous throws and rejections by identity', async () => {
  const thrown = new Error('sync-boom');
  const { port } = makePort({
    invokeImpl() {
      throw thrown;
    },
  });
  const t = createPreloadTransport(port);
  try {
    t.invoke('review:probe');
    assert.fail('expected invoke to throw');
  } catch (error) {
    assert.equal(error, thrown, 'invoke must propagate the synchronous throw by identity');
  }
  const reason = { failed: true };
  const { port: port2 } = makePort({ invokeImpl: () => Promise.reject(reason) });
  const t2 = createPreloadTransport(port2);
  await t2.invoke('review:probe').then(
    () => assert.fail('expected rejection'),
    (error) => assert.equal(error, reason, 'invoke must propagate the rejection reason by identity'),
  );
});

test('subscriptions create distinct listeners and pass only the second value', () => {
  const { port, listeners } = makePort();
  const t = createPreloadTransport(port);
  const receivedA = [];
  const receivedB = [];
  const retA = { done: 'a' };
  const cleanupA = t.onIpc('review:a', (...args) => {
    receivedA.push(args);
    return retA;
  });
  const cleanupB = t.onIpc('review:b', (...args) => {
    receivedB.push(args);
    return undefined;
  });
  assert.equal(listeners.get('review:a').length, 1);
  assert.equal(listeners.get('review:b').length, 1);
  assert.notEqual(listeners.get('review:a')[0], listeners.get('review:b')[0], 'two subscriptions have distinct listeners');
  const event = { sender: 'x' };
  const value = { payload: 7 };
  const extra = 'ignored-third';
  const [listenerA] = listeners.get('review:a');
  const returned = listenerA(event, value, extra);
  assert.equal(returned, retA, 'callback return value is preserved');
  assert.equal(receivedA.length, 1);
  assert.equal(receivedA[0].length, 1, 'callback must receive exactly one argument');
  assert.equal(receivedA[0][0], value, 'callback must receive exactly the second value, never the event');
  assert.equal(typeof cleanupA, 'function');
  assert.equal(typeof cleanupB, 'function');
});

test('listener callback throws propagate by identity', () => {
  const { port, listeners } = makePort();
  const t = createPreloadTransport(port);
  const thrown = new Error('cb-boom');
  t.onIpc('review:probe', () => {
    throw thrown;
  });
  const [listener] = listeners.get('review:probe');
  try {
    listener({}, 1);
    assert.fail('expected listener to throw');
  } catch (error) {
    assert.equal(error, thrown, 'listener must propagate the callback throw by identity');
  }
});

test('cleanup uses the same channel/listener/receiver and returns off result', () => {
  const offReturn = { removed: true };
  const seen = [];
  const { port } = makePort({
    offImpl(channel, listener) {
      seen.push({ channel, listener, receiver: this });
      return offReturn;
    },
  });
  const t = createPreloadTransport(port);
  const cb = () => {};
  const cleanup = t.onIpc('review:channel', cb);
  const first = cleanup();
  assert.equal(first, offReturn, 'cleanup must return off result identity');
  const second = cleanup();
  assert.equal(second, offReturn, 'repeated cleanup still calls off (no once flag)');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].channel, 'review:channel');
  assert.equal(seen[0].receiver, port);
  assert.equal(seen[1].listener, seen[0].listener, 'repeated cleanup reuses the same listener');
});

test('cleanup propagates removal throws by identity', () => {
  const thrown = new Error('off-boom');
  const { port } = makePort({
    offImpl() {
      throw thrown;
    },
  });
  const t = createPreloadTransport(port);
  const cleanup = t.onIpc('review:channel', () => {});
  try {
    cleanup();
    assert.fail('expected cleanup to throw');
  } catch (error) {
    assert.equal(error, thrown, 'cleanup must propagate the removal throw by identity');
  }
});

if (!process.env.TSA_BONNO_PRELOAD_TRANSPORT_VARIANT) {
  test('the real transport assertions catch isolated semantic variants', () => {
    const hook = resolve(root, 'tests/typecheck/preload-transport/runtime-variant-hook.mjs');
    const testFile = resolve(root, 'tests/preload-transport.test.mjs');
    const variants = [
      ['async-invoke', 'invoke must return the exact promise object'],
      ['forward-event', 'callback must receive exactly the second value'],
      ['discard-off-result', 'cleanup must return off result identity'],
    ];
    for (const [variant, expected] of variants) {
      const childEnv = { ...process.env, TSA_BONNO_PRELOAD_TRANSPORT_VARIANT: variant };
      delete childEnv.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, '--test', testFile], {
        cwd: root,
        encoding: 'utf8',
        env: childEnv,
      });
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      assert.notEqual(result.status, 0, `${variant} should fail the actual transport assertions:\n${output}`);
      assert.match(output, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${variant} must fail at its intended assertion`);
      assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|Cannot find module|TypeError:.*(?:undefined|null)/, `${variant} must resolve the real helper and fail semantically`);
    }
  });
}

// ---- live preload VM bootstrap: real factory, synthetic host, both branches ----
function stripKnownImports(source, { hasTransportImport }) {
  const targets = ["import electron from 'electron'"];
  if (hasTransportImport) targets.push("import { createPreloadTransport } from './transport.js'");
  let stripped = source;
  for (const target of targets) {
    const occurrences = stripped.split(target).length - 1;
    assert.equal(occurrences, 1, `expected exactly one occurrence to strip: ${JSON.stringify(target)}`);
    stripped = stripped.replace(`${target}\r\n`, '');
    if (stripped.includes(target)) stripped = stripped.replace(`${target}\n`, '');
    assert.equal(stripped.includes(target), false, `failed to strip: ${JSON.stringify(target)}`);
  }
  return stripped;
}

function bootstrapPreload({ contextIsolated, exposeThrows = false, source = read('src/preload/index.js') }) {
  const hasTransportImport = source.includes("import { createPreloadTransport } from './transport.js'");
  const stripped = stripKnownImports(source, { hasTransportImport });
  const calls = [];
  const listeners = new Map();
  const port = {
    invoke(channel, ...args) {
      calls.push({ method: 'invoke', channel, args });
      return Promise.resolve({ synthetic: true });
    },
    on(channel, listener) {
      calls.push({ method: 'on', channel });
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel).push(listener);
    },
    off(channel, listener) {
      calls.push({ method: 'off', channel });
      return { removed: channel };
    },
  };
  const exposed = {};
  const errors = [];
  const context = vm.createContext({
    electron: {
      contextBridge: {
        exposeInMainWorld(name, value) {
          if (exposeThrows) throw new Error('bridge-boom');
          exposed[name] = value;
        },
      },
      ipcRenderer: port,
      webUtils: {},
    },
    createPreloadTransport,
    process: { contextIsolated },
    window: {},
    console: { error: (error) => errors.push(error) },
  });
  vm.runInContext(stripped, context, { filename: 'preload-index.vm.js' });
  return { exposedApi: contextIsolated ? exposed.api : context.window.api, calls, listeners, errors, context };
}

test('live preload exposes the real API shape in the isolated branch', () => {
  const { exposedApi, calls, errors } = bootstrapPreload({ contextIsolated: true });
  assert.equal(errors.length, 0);
  assert.equal(typeof exposedApi, 'object');
  for (const key of ['auth', 'updates', 'pos', 'profiles']) {
    assert.ok(key in exposedApi, `exposed api has ${key}`);
  }
  assert.equal(typeof exposedApi.auth.login, 'function');
  assert.equal(typeof exposedApi.updates.onAvailable, 'function');
  assert.equal(typeof exposedApi.updates.install, 'function');
});

test('live preload routes representative invoke/event methods through the factory', async () => {
  const { exposedApi, calls, listeners } = bootstrapPreload({ contextIsolated: true });
  const loginPromise = exposedApi.auth.login('a@b.c', 'pw', null);
  assert.equal(calls[0].method, 'invoke');
  assert.equal(calls[0].channel, 'auth:login');
  assert.deepEqual(calls[0].args, ['a@b.c', 'pw', null]);
  await loginPromise.then((value) => assert.deepEqual(value, { synthetic: true }));
  const seen = [];
  const cleanup = exposedApi.updates.onAvailable((value) => {
    seen.push(value);
    return 'ok';
  });
  const [listener] = listeners.get('update:available');
  assert.equal(typeof listener, 'function');
  assert.equal(listener({ sender: 'nope' }, 'ready!'), 'ok');
  assert.deepEqual(seen, ['ready!']);
  assert.deepEqual(cleanup(), { removed: 'update:available' });
});

test('live preload falls back to window.api without isolation', () => {
  const { exposedApi, context } = bootstrapPreload({ contextIsolated: false });
  assert.equal(context.window.api, exposedApi);
  assert.equal(typeof exposedApi.pos.getMenuItems, 'function');
});

test('live preload keeps existing exposure-error handling', () => {
  const { exposedApi, errors } = bootstrapPreload({ contextIsolated: true, exposeThrows: true });
  assert.equal(exposedApi, undefined);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'bridge-boom');
});

test('live preload keeps its API type and captured runtime property order', () => {
  const baseline = read('docs/engineering/typescript-migration/evidence/L01-preload-preextraction-api-2026-10-14.js.txt');
  const current = read('src/preload/index.js');
  assert.match(current, /\/\*\* @type \{import\('\.\.\/renderer\/src\/types\/desktop-api\.js'\)\.DesktopApi\} \*\//, 'preload API must remain bound to its renderer contract');
  const beforeApi = bootstrapPreload({ contextIsolated: true, source: baseline }).exposedApi;
  const currentApi = bootstrapPreload({ contextIsolated: true, source: current }).exposedApi;
  assert.deepEqual(apiShape(currentApi), apiShape(beforeApi), 'all exposed API paths and function members remain present');
  assert.deepEqual(apiKeyOrder(currentApi), apiKeyOrder(beforeApi), 'object property insertion order remains unchanged');
});

function apiShape(value, seen = new Set()) {
  if (typeof value === 'function') return 'function';
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  if (seen.has(value)) return 'circular';
  seen.add(value);
  const shape = Array.isArray(value)
    ? { kind: 'array', length: value.length, items: value.map((item) => apiShape(item, seen)) }
    : {
      kind: 'object',
      members: Object.fromEntries(Object.keys(value).sort().map((key) => [key, apiShape(value[key], seen)])),
    };
  seen.delete(value);
  return shape;
}

function apiKeyOrder(value) {
  return Object.keys(value).map((key) => [
    key,
    typeof value[key] === 'function' ? null : apiKeyOrder(value[key]),
  ]);
}

test('current preload has the same full API shape as the captured pre-extraction API in both exposure branches', () => {
  const baseline = read('docs/engineering/typescript-migration/evidence/L01-preload-preextraction-api-2026-10-14.js.txt');
  const current = read('src/preload/index.js');
  for (const contextIsolated of [true, false]) {
    const before = bootstrapPreload({ contextIsolated, source: baseline });
    const after = bootstrapPreload({ contextIsolated, source: current });
    assert.deepEqual(apiShape(after.exposedApi), apiShape(before.exposedApi), `API shape changed (contextIsolated=${contextIsolated})`);
  }
});
