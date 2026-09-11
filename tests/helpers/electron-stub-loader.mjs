// Node module customization hooks for behavioral domain tests:
// 1. redirect bare 'electron' imports to the test stub;
// 2. rewrite Vite-only `import.meta.env` to a test global (Vite defines it at
//    bundle time; plain node leaves import.meta.env undefined and several
//    domain modules read it at load time);
// 3. transform .jsx sources with esbuild so pure component logic (validators,
//    decision helpers) executes under node:test without a bundler.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const stubUrl = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'electron-stub.mjs')).href;
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), 'domain-test-setup.mjs'));

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') return { url: stubUrl, shortCircuit: true };
  try {
    const resolved = await nextResolve(specifier, context);
    if (resolved.url.endsWith('.jsx')) return { url: resolved.url, format: 'module', shortCircuit: true };
    return resolved;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      for (const extension of ['.jsx', '.js', '.json']) {
        try {
          const candidate = await nextResolve(specifier + extension, context);
          return { url: candidate.url, format: 'module', shortCircuit: true };
        } catch { /* try next extension */ }
      }
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.jsx')) {
    const source = fs.readFileSync(fileURLToPath(url), 'utf8');
    const { transformSync } = require('esbuild');
    const out = transformSync(source, { loader: 'jsx', jsx: 'automatic', format: 'esm' });
    return {
      format: 'module',
      source: out.code.replaceAll('import.meta.env', 'globalThis.__TEST_VITE_ENV__'),
      shortCircuit: true
    };
  }
  const result = await nextLoad(url, context);
  if (url.startsWith('file:') && result.format === 'module' &&
      (url.includes('/src/main/') || url.includes('/src/shared/'))) {
    const source = String(result.source);
    if (source.includes('import.meta.env')) {
      return {
        format: 'module',
        source: source.replaceAll('import.meta.env', 'globalThis.__TEST_VITE_ENV__'),
        shortCircuit: true
      };
    }
  }
  return result;
}
