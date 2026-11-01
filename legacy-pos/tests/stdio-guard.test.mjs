import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installStdioGuards } from '../src/main/stdioGuard.js';

test('Closed terminal pipes do not become uncaught main-process errors', () => {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  installStdioGuards([stdout, stderr]);
  installStdioGuards([stdout, stderr]);
  assert.equal(stdout.listenerCount('error'), 1);
  assert.equal(stderr.listenerCount('error'), 1);
  for (const stream of [stdout, stderr]) {
    assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('closed pipe'), { code: 'EPIPE' })));
    assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('closed stream'), { code: 'ERR_STREAM_DESTROYED' })));
  }
});

test('Stdio guard does not swallow unrelated failures', () => {
  const stream = new EventEmitter();
  installStdioGuards([stream]);
  const failure = Object.assign(new Error('disk failure'), { code: 'EIO' });
  assert.throws(() => stream.emit('error', failure), (error) => error === failure);
});
