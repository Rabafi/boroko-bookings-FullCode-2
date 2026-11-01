import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { barLocalReadinessMessage } from '../../src/shared/barLocalOperatorMessages.js';

const source = readFileSync(join(import.meta.dirname, '../src/renderer/src/screens/BarLocalWorkspace.jsx'), 'utf8');
const helperSource = source.match(/const READINESS_MAX_AGE_MS = 45000;[\s\S]*?(?=\nfunction getMessage)/)?.[0];
assert.ok(helperSource, 'readiness presentation helpers should remain in the Legacy Bar workspace');
const context = { barLocalReadinessMessage };
vm.runInNewContext(`${helperSource}\nglobalThis.getReadinessState = getReadinessState; globalThis.describeReadiness = describeReadiness;`, context);

test('Legacy Bar readiness distinguishes unknown, unavailable, stale, blocked and ready results', () => {
  const now = 100000;
  assert.equal(context.getReadinessState(null, now), 'unknown');
  assert.equal(context.getReadinessState({ unavailableAt: now }, now), 'unavailable');
  assert.equal(context.getReadinessState({ checkedAt: now - 45000, ready: true }, now), 'stale');
  assert.equal(context.getReadinessState({ checkedAt: now, ready: false, blockers: ['database'] }, now), 'blocked');
  assert.equal(context.getReadinessState({ checkedAt: now, ready: true }, now), 'ready');
  assert.match(context.describeReadiness('blocked', { blockers: ['database'] }), /Trading is paused/);
  assert.match(context.describeReadiness('unavailable'), /Cannot reach the Bar server/);
  assert.match(context.describeReadiness('stale'), /Checking the Bar server/);
  assert.match(context.describeReadiness('unknown'), /Please wait before selling/);
});

test('Legacy Bar mutations are enabled only for a current ready result and connection claims stay scoped', () => {
  assert.match(source, /const localReady = readinessState === 'ready';/);
  assert.match(source, /current\?\.blockers \|\| \[\], unavailableAt: Date\.now\(\)/);
  assert.match(source, /Last successful authenticated check:/);
  assert.doesNotMatch(source, /internet connection|LAN connection|automatic failover|replica is healthy/i);
});

test('Legacy returns and voids refuse stale readiness before approval', () => {
  const returns = source.slice(source.indexOf('const submitReturn ='), source.indexOf('const submitSaleVoid ='));
  const voids = source.slice(source.indexOf('const submitSaleVoid ='), source.indexOf('const closeShift ='));
  for (const handler of [returns, voids]) {
    assert.ok(handler.indexOf("getReadinessState(readiness) !== 'ready'") >= 0);
    assert.ok(handler.indexOf('getReadinessState(readiness)') < handler.indexOf('requestApproval('));
  }
  assert.doesNotMatch(source, /selectedSale\.status !== 'completed'[^\n]*!readiness\?\.ready/);
});
