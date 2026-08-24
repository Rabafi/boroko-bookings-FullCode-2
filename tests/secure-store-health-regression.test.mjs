import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { state } from '../src/main/state.js';
import {
  CRITICAL_ERROR_DEDUPE_WINDOW_MS,
  recordCriticalError
} from '../src/main/domains/operationalLog.js';
import {
  appendHealthFault,
  readHealthFaults
} from '../src/main/domains/syncStore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('secure local store fails closed and callers observe persistence failure', () => {
  const secureStore = read('src/main/domains/secureLocalStore.js');
  const authCache = read('src/main/domains/authCache.js');
  const authSession = read('src/main/domains/authSession.js');
  const main = read('src/main/index.js');

  assert.match(secureStore, /if \(!canUseSafeStorage\(\)\)[\s\S]*?return false/);
  assert.doesNotMatch(secureStore, /canUseSafeStorage\(\)\s*\?\s*buildEncryptedEnvelope\(value\)\s*:\s*value/);
  assert.match(secureStore, /Do not return sensitive plaintext to a caller if migration failed/);
  assert.match(authCache, /const written = writeSecureJson/);
  assert.match(authCache, /return written/);
  assert.match(authSession, /const nonceWritten = writeSecureJson/);
  assert.match(authSession, /return writeTrustedSessions\(next\)/);
  assert.match(authSession, /writeSessionNonce\(user, nonce, password\) \? nonce : null/);
  assert.match(main, /const savedSessionNonce = db\.createSessionNonce/);
  assert.match(main, /could not save a secure offline session/);
});

test('critical errors redact bounded context and dedupe only exact repeats', () => {
  const previousCacheDir = state.cacheDir;
  const previousUser = state.currentUser;
  const previousLodgeId = state.lodgeId;
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-bonno-health-'));
  state.cacheDir = cacheDir;
  state.currentUser = { id: 'user-1', name: 'Test Operator' };
  state.lodgeId = 'lodge-1';

  try {
    const first = recordCriticalError(
      'auth.secure_storage',
      new Error('secure storage failed token=super-secret-value'),
      {
        context: 'session_nonce_write',
        token: 'super-secret-value',
        nested: { password: 'do-not-persist', outlet: 'bar' }
      }
    );
    const exactRepeat = recordCriticalError(
      'auth.secure_storage',
      new Error('secure storage failed token=super-secret-value'),
      {
        nested: { outlet: 'bar', password: 'do-not-persist' },
        token: 'super-secret-value',
        context: 'session_nonce_write'
      }
    );
    const distinctContext = recordCriticalError(
      'auth.secure_storage',
      new Error('secure storage failed token=super-secret-value'),
      {
        context: 'trusted_sessions_write',
        token: 'super-secret-value',
        nested: { password: 'do-not-persist', outlet: 'bar' }
      }
    );

    assert.ok(first?.fingerprint);
    assert.equal(exactRepeat, null);
    assert.ok(distinctContext?.fingerprint);
    assert.notEqual(first.fingerprint, distinctContext.fingerprint);
    assert.equal(CRITICAL_ERROR_DEDUPE_WINDOW_MS, 10 * 60 * 1000);

    const rows = JSON.parse(fs.readFileSync(path.join(cacheDir, 'critical-errors.json'), 'utf8'));
    assert.equal(rows.length, 2);
    assert.equal(rows.every((row) => row.fingerprint), true);
    assert.equal(rows.some((row) => JSON.stringify(row).includes('super-secret-value')), false);
    assert.equal(rows.some((row) => JSON.stringify(row).includes('do-not-persist')), false);
    assert.equal(rows.some((row) => row.details.nested.outlet === 'bar'), true);
  } finally {
    state.cacheDir = previousCacheDir;
    state.currentUser = previousUser;
    state.lodgeId = previousLodgeId;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('sync health faults retain distinct incidents and redact context', () => {
  const previousCacheDir = state.cacheDir;
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsa-bonno-sync-health-'));
  state.cacheDir = cacheDir;

  try {
    const base = {
      type: 'queue_corrupt',
      scope: 'sync-queue',
      severity: 'error',
      message: 'Queue recovery failed token=super-secret-value'
    };
    appendHealthFault({ ...base, context: { file: 'sync-queue.json', token: 'super-secret-value', reason: 'parse' } });
    appendHealthFault({ ...base, context: { file: 'sync-queue.json', token: 'super-secret-value', reason: 'parse' } });
    appendHealthFault({ ...base, context: { file: 'sync-queue.json', token: 'super-secret-value', reason: 'permission' } });

    const rows = readHealthFaults();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].fingerprint && rows[1].fingerprint ? true : false, true);
    assert.notEqual(rows[0].fingerprint, rows[1].fingerprint);
    assert.equal(JSON.stringify(rows).includes('super-secret-value'), false);
    assert.equal(rows.every((row) => row.context.token === '[REDACTED]'), true);

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      for (let index = 0; index < 55; index += 1) {
        appendHealthFault({
          ...base,
          message: `Distinct queue incident ${index}`,
          context: { index }
        });
      }
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(readHealthFaults().length, 50);
  } finally {
    state.cacheDir = previousCacheDir;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
