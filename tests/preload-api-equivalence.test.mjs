import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createPreloadTransport } from '../src/preload/transport.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const beforePath = resolve(root, 'docs/engineering/typescript-migration/evidence/L02-preimages-coordinator-2026-10-15/preload-index-before-desktop-contract.js');
const currentPath = resolve(root, 'src/preload/index.js');

function loadApi(source) {
  const executable = source
    .replace(/^import electron from 'electron'\r?\n/m, 'const electron = globalThis.__electron;\n')
    .replace(/^import \{ createPreloadTransport \} from '\.\/transport\.js'\r?\n/m, 'const createPreloadTransport = globalThis.__createPreloadTransport;\n');
  assert.notEqual(executable, source, 'expected the preload imports to be replaced by the isolated loader');
  const calls = [];
  let exposed;
  const port = {
    invoke(channel, ...args) {
      calls.push({ channel, args });
      return Promise.resolve({ channel });
    },
    on() {},
    off() {},
  };
  const contextBridge = {
    exposeInMainWorld(name, value) {
      assert.equal(name, 'api');
      exposed = value;
    },
  };
  const sandbox = {
    __createPreloadTransport: createPreloadTransport,
    __electron: {
      contextBridge,
      ipcRenderer: port,
      webUtils: { getPathForFile: (file) => file.path ?? '' },
    },
    process: { contextIsolated: true },
    console: { error(error) { throw error; } },
  };
  vm.runInNewContext(executable, sandbox, { filename: 'src/preload/index.js' });
  assert.ok(exposed, 'preload must expose its API through contextBridge');
  return { api: exposed, calls };
}

function apiShape(value, prefix = '') {
  return Object.keys(value).sort().map((key) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const child = value[key];
    return typeof child === 'function' ? `${path}()` : [path, ...apiShape(child, path)];
  });
}

function apiKeyOrder(value) {
  return Object.keys(value).map((key) => [
    key,
    typeof value[key] === 'function' ? null : apiKeyOrder(value[key]),
  ]);
}

test('preload API shape and property order match the source preimage', async () => {
  const before = loadApi(readFileSync(beforePath, 'utf8'));
  const current = loadApi(readFileSync(currentPath, 'utf8'));
  assert.deepEqual(apiShape(current.api), apiShape(before.api));
  assert.deepEqual(apiKeyOrder(current.api), apiKeyOrder(before.api));

  const oldResult = before.api.payments.getProviderConfig('cash', 'lodge-7');
  const newResult = current.api.payments.getProviderConfig('cash', 'lodge-7');
  assert.deepEqual(await newResult, await oldResult);
  assert.deepEqual(current.calls, before.calls);
  assert.deepEqual(current.calls, [{ channel: 'payments:getProviderConfig', args: ['cash', 'lodge-7'] }]);
});
