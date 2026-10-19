import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const variant = process.env.TSA_BONNO_PRELOAD_TRANSPORT_VARIANT;
const target = pathToFileURL(resolve('src/preload/transport.js')).href;
const replacements = {
  'async-invoke': [
    'const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)',
    'const invoke = async (channel, ...args) => ipcRenderer.invoke(channel, ...args)',
  ],
  'forward-event': [
    'const listener = (_, value) => cb(value)',
    'const listener = (event, value) => cb(event)',
  ],
  'discard-off-result': [
    'return () => ipcRenderer.off(channel, listener)',
    'return () => { ipcRenderer.off(channel, listener) }',
  ],
};

assert.ok(variant && Object.hasOwn(replacements, variant), `unknown transport variant: ${variant}`);
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== target) return loaded;
    assert.equal(loaded.format, 'module', 'the real helper must resolve as an ES module');
    const [before, after] = replacements[variant];
    const source = typeof loaded.source === 'string'
      ? loaded.source
      : Buffer.from(loaded.source).toString('utf8');
    assert.equal(source.split(before).length - 1, 1, `expected one anchored ${variant} helper expression`);
    return { ...loaded, source: source.replace(before, after) };
  },
});
