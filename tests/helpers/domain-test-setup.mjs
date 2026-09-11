// Shared setup for behavioral tests that execute real main-process domain
// modules under node:test. Registers the Electron stub loader, then provides
// an isolated temp cache dir plus state/supabase scripting helpers.
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

register(new URL('./electron-stub-loader.mjs', import.meta.url));

globalThis.__TEST_VITE_ENV__ = {};

export async function importDomain(relativePath) {
  return import(pathToFileURL(path.resolve('src/main/domains', relativePath)).href);
}

export async function importState() {
  return import(pathToFileURL(path.resolve('src/main/state.js')).href);
}

export function makeTempCacheDir(prefix = 'tsa-bonno-domain-test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return dir;
}

export function scriptSupabase(impl) {
  return { rpc: impl };
}

export function scriptRpcSuccess(map) {
  return scriptSupabase(async (name, args) => {
    if (Object.prototype.hasOwnProperty.call(map, name)) {
      const value = typeof map[name] === 'function' ? await map[name](args) : map[name];
      return { data: value, error: null };
    }
    throw new Error(`unexpected RPC in test: ${name}`);
  });
}
